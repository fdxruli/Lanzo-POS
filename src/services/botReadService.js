import { actorRuntimeController } from './auth/actorRuntimeController';
import { canAuditSalesReports, getSalesFinalHistoryScope } from './auth/salesPermissionPolicy';

const currency = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' });
const finite = (value) => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
const unavailable = (message) => ({ title: 'Datos no confirmados', message, actions: [] });
const cancelled = () => Object.assign(new Error('BOT_CANCELLED'), { code: 'BOT_CANCELLED' });
const warningsFor = (report) => [...new Set([
  ...(report.source?.mode === 'local' ? ['Datos locales de este dispositivo; pueden no incluir operaciones de otros dispositivos ni pendientes de sincronización.'] : []),
  ...(report.source?.stale || report.source?.mode === 'cache' ? ['Último reporte guardado: puede estar desactualizado.'] : []),
  ...(report.source?.warnings || []), ...(report.warnings || [])
].map(item => typeof item === 'string' ? item : item?.message).filter(Boolean))];

/** Read-only adapter. Authority is captured before loading services and checked at every await. */
export const readBotBusinessData = async (intent, timeframe, { signal } = {}) => {
  let handle;
  try {
    handle = actorRuntimeController.capture('reports');
    const permission = intent === 'customer_debt' ? 'customers' : ['low_stock', 'expiration_alert'].includes(intent) ? 'inventory' : 'reports';
    const check = () => {
      if (signal?.aborted) throw cancelled();
      handle.assertCurrent('reports');
      return handle.assertCurrent(permission);
    };
    const read = async (operation) => {
      check();
      const value = await operation();
      check();
      if (!value || (Object.hasOwn(value, 'success') && value.success === false)) throw new Error('BOT_READ_FAILED');
      return value;
    };
    const actor = check();
    const canAudit = canAuditSalesReports(actor);
    const filters = { dateFrom: timeframe.dateFrom, dateTo: timeframe.dateTo, dateRange: { start: timeframe.start, end: timeframe.end }, scope: getSalesFinalHistoryScope(actor) };
    if (['low_stock', 'expiration_alert'].includes(intent)) {
      const inventory = await read(() => import('./inventoryAnalysis'));
      const rows = await read(() => intent === 'low_stock'
        ? inventory.getLowStockProductsReport({ limit: 5, throwOnError: true })
        : inventory.getExpiringProductsReport({ daysThreshold: 7, throwOnError: true }));
      if (!Array.isArray(rows)) throw new Error('BOT_READ_FAILED');
      return {
        title: intent === 'low_stock' ? 'Stock bajo · copia local' : 'Caducidad · próximos 7 días',
        message: rows.length ? rows.slice(0, 5).map(item => intent === 'low_stock'
          ? `• ${item.name || item.productName}: ${item.currentStock ?? item.stock} disponibles`
          : `• ${item.productName || item.name}: ${item.daysRemaining} día(s), lote ${item.batchSku}`).join('\n')
          : 'La consulta local no encontró productos con esos criterios. Comprueba las fechas, lotes y existencias capturados.',
        tips: ['Copia local de este dispositivo; puede estar incompleta o pendiente de sincronización.', 'Se muestran hasta 5 resultados.'],
        actions: [{ label: 'Revisar reporte completo', path: intent === 'low_stock' ? '/ventas?tab=restock' : '/ventas?tab=expiration' }]
      };
    }
    const { reportsRepository } = await read(() => import('./reports/reportsRepository'));
    const report = await read(() => intent === 'customer_debt'
      ? reportsRepository.getCustomerCreditReport({ scope: filters.scope, limit: 5 })
      : reportsRepository.getOverviewReport(filters));
    const local = report.source?.mode === 'local';
    // The local repository has no per-actor filter. Never expose its business-wide fallback to ordinary Staff.
    if (!canAudit && (local || report.source?.mode === 'mixed' || (report.source?.mode === 'cache' && !report.source?.official?.includes(intent === 'customer_debt' ? 'customer_credit' : 'sales')))) return unavailable('El reporte local disponible no separa los datos de tu usuario. No puedo mostrar cifras de todo el negocio con esta sesión. Consulta un reporte Nube autorizado o solicita revisión al administrador.');
    if (!report.source?.mode) return unavailable('El servicio no identificó la fuente del reporte. Revisa Reportes antes de utilizar una cifra.');
    const tips = warningsFor(report);
    const sourceLabel = ({ local: 'Local', cloud: 'Nube', cloud_final: 'Nube final', mixed: 'Mixto', cache: 'Último reporte guardado' })[report.source.mode] || report.source.mode;
    const actions = [{ label: 'Abrir reporte', path: intent === 'customer_debt' ? '/clientes?tab=list' : '/ventas' }];
    if (intent === 'customer_debt') {
      if (!Array.isArray(report.top_debtors)) return unavailable('El servicio no entregó una lista de saldos confirmada. Revisa Clientes para consultar las cuentas pendientes.');
      const debtors = report.top_debtors.slice(0, 5);
      if (debtors.some(item => !finite(item.debt_cents ?? item.debtCents ?? item.debt))) return unavailable('Hay saldos sin un importe válido. No puedo confirmar quién debe ni cuánto. Revisa Clientes.');
      return {
        title: `Cuentas pendientes · ${sourceLabel}`,
        message: debtors.length ? debtors.map(item => {
          const cents = item.debt_cents ?? item.debtCents;
          const amount = cents !== undefined && cents !== null ? Number(cents) / 100 : Number(item.debt);
          return `• ${item.name || item.customer_name || 'Cliente'}: ${currency.format(amount)}`;
        }).join('\n') : 'El reporte no encontró clientes con deuda en el alcance consultado.',
        tips: [...tips, 'Hasta 5 cuentas del reporte; no representa un total global de deuda.'], actions
      };
    }
    if (intent === 'top_products') {
      if (!local || !Array.isArray(report.sales)) return { ...unavailable('Este reporte Nube no entrega un ranking completo de productos. No puedo calcular los más vendidos a partir de una página parcial. Revisa los análisis disponibles en Reportes o Lía.'), actions };
      const { aggregateProductStats } = await read(() => import('./reports/productStats'));
      const rows = aggregateProductStats(report.sales).sort((a, b) => b.quantity - a.quantity).slice(0, 5);
      return { title: `Productos por unidades · ${timeframe.label}`, message: rows.length ? rows.map(item => `• ${item.name}: ${item.quantity} unidades`).join('\n') : 'No hay productos vendidos en el período consultado.', tips, actions };
    }
    let value;
    let profitStatus;
    if (local) {
      if (!Array.isArray(report.sales)) return unavailable('El reporte no entregó ventas locales para confirmar la cifra.');
      const { summarizeFinancialSales } = await read(() => import('./sales/financialPolicy'));
      const summary = summarizeFinancialSales(report.sales);
      if (!report.sales.length) return { title: `Sin ventas · ${timeframe.label}`, message: 'No hay ventas cerradas en el período consultado en este dispositivo.', tips, actions };
      if (intent === 'profit_report' && (summary.hasMissingCosts || report.sales.some(sale => !Array.isArray(sale.items) || sale.items.length === 0))) return { ...unavailable('Faltan costos o detalles de artículos. No puedo confirmar una ganancia total para este período. Revisa costos y calidad de datos en Reportes.'), tips, actions };
      value = intent === 'profit_report' ? summary.confirmedProfit : summary.totalRevenue;
      profitStatus = 'estimated';
    } else {
      const overview = report.overview || report.summary || {};
      value = intent === 'profit_report' ? overview.gross_profit_total ?? overview.grossProfitTotal : overview.net_sales_total ?? overview.netSalesTotal;
      profitStatus = overview.profit_status ?? overview.profitStatus;
      if (intent === 'profit_report' && !['definitive', 'estimated'].includes(profitStatus)) return { ...unavailable('El reporte no confirma la calidad de los costos. No puedo presentar la ganancia como una cifra completa.'), tips, actions };
    }
    check();
    if (!finite(value)) return { ...unavailable('El servicio no entregó un importe válido. No lo interpretaré como cero; revisa Reportes.'), tips, actions };
    return {
      title: `${intent === 'profit_report' ? 'Ganancia bruta' : 'Ventas netas'} · ${timeframe.label}`,
      message: `${currency.format(Number(value))} · ${sourceLabel}${intent === 'profit_report' && profitStatus === 'estimated' ? ' · estimada' : ''}.`,
      tips: [...tips, ...(intent === 'profit_report' ? ['La ganancia bruta no descuenta todos los gastos del negocio ni equivale al efectivo disponible.'] : [])], actions
    };
  } catch (error) {
    if (signal?.aborted || error.code === 'BOT_CANCELLED') throw cancelled();
    if (error.code === 'ACTOR_PERMISSION_DENIED') return { title: 'Consulta protegida', message: 'Tu sesión no tiene permiso para consultar estos datos. Puedes seguir usando las guías operativas; solicita al administrador revisar los permisos de reportes y del módulo correspondiente.' };
    if (String(error.code || '').startsWith('ACTOR_') || String(error.code || '').startsWith('TENANT_')) return unavailable('La sesión o el negocio activo cambió o no está listo. Vuelve a abrir el asistente desde tu sesión actual. No se mostraron datos de la consulta anterior.');
    // Recheck failed requests too: stale sessions must never yield recoverable data responses.
    try { handle?.assertCurrent('reports'); } catch { return unavailable('La sesión cambió durante la consulta. Vuelve a abrir el asistente.'); }
    return { ...unavailable('No pude leer el reporte. No hay una cifra confirmada. Revisa la conexión o vuelve a intentar; la ayuda operativa sigue disponible.'), retryable: true };
  }
};
