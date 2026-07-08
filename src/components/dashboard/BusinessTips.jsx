import { useMemo } from 'react';
import {
  ArrowRight,
  BarChart3,
  CheckCircle,
  Lightbulb,
  Lock,
  Package,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  Users
} from 'lucide-react';
import { normalizeBusinessType } from '../../utils/businessType';
import './BusinessTips.css';

const currencyFormatter = new Intl.NumberFormat('es-MX', {
  style: 'currency',
  currency: 'MXN',
  maximumFractionDigits: 0
});

const EMPTY_ARRAY = [];

const getNumber = (value, fallback = 0) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const getSaleTotal = (sale = {}) => getNumber(
  sale.total ?? sale.totalAmount ?? sale.grandTotal ?? sale.amount ?? sale.total_price ?? sale.subtotal,
  0
);

const getProductPrice = (product = {}) => getNumber(
  product.price ?? product.sale_price ?? product.sellPrice ?? product.unitPrice,
  0
);

const getProductCost = (product = {}) => getNumber(
  product.cost ?? product.unit_cost ?? product.purchase_price ?? product.baseCost,
  0
);

const getProductStock = (product = {}) => getNumber(
  product.stock ?? product.quantity ?? product.current_stock ?? product.inventory,
  0
);

const getRubroLabel = (activeRubros = []) => {
  const first = Array.isArray(activeRubros) ? activeRubros[0] : activeRubros;
  const normalized = normalizeBusinessType(first);

  const labels = {
    food_service: 'negocio de comida',
    farmacia: 'farmacia',
    abarrotes: 'tienda',
    'verduleria/fruteria': 'fruteria o verduleria',
    apparel: 'tienda de ropa',
    hardware: 'ferreteria'
  };

  return labels[normalized] || 'negocio';
};

const buildLocalTips = ({ sales, menu, customers, wasteLogs, activeRubros }) => {
  const totalSales = sales.length;
  const totalRevenue = sales.reduce((sum, sale) => sum + getSaleTotal(sale), 0);
  const avgTicket = totalSales > 0 ? totalRevenue / totalSales : 0;
  const productsWithoutPrice = menu.filter(product => getProductPrice(product) <= 0).length;
  const productsWithoutCost = menu.filter(product => getProductCost(product) <= 0).length;
  const productsWithoutStock = menu.filter(product => getProductStock(product) <= 0).length;
  const rubroLabel = getRubroLabel(activeRubros);

  const tips = [];

  if (totalSales < 5) {
    tips.push({
      id: 'build-history',
      icon: BarChart3,
      tone: 'info',
      title: 'Junta historial antes de tomar decisiones fuertes',
      description: `Tu ${rubroLabel} necesita mas ventas registradas para detectar patrones confiables.`,
      action: 'Registra ventas reales durante al menos 7 dias seguidos.',
      route: '/',
      metric: `${totalSales} ventas registradas`
    });
  } else {
    tips.push({
      id: 'ticket-focus',
      icon: TrendingUp,
      tone: 'success',
      title: 'Usa tu ticket promedio como brujula',
      description: `Tu ticket promedio estimado es ${currencyFormatter.format(avgTicket)}. Usalo para crear combos o metas de venta.`,
      action: 'Busca subir el ticket con complementos sencillos, no solo vendiendo mas piezas.',
      route: '/ventas',
      metric: currencyFormatter.format(avgTicket)
    });
  }

  if (menu.length === 0) {
    tips.push({
      id: 'catalog-start',
      icon: Package,
      tone: 'warning',
      title: 'Carga tu catalogo base',
      description: 'Sin productos registrados, Lanzo no puede ayudarte a medir inventario, precios ni margen.',
      action: 'Agrega tus productos mas vendidos primero.',
      route: '/productos?tab=add',
      metric: '0 productos'
    });
  } else if (productsWithoutPrice > 0 || productsWithoutCost > 0) {
    tips.push({
      id: 'catalog-quality',
      icon: Package,
      tone: 'warning',
      title: 'Completa precios y costos para cuidar margen',
      description: 'Hay productos con precio o costo incompleto. Eso limita los reportes y puede ocultar perdidas.',
      action: 'Revisa los productos sin precio o sin costo antes de hacer promociones.',
      route: '/productos?tab=list',
      metric: `${productsWithoutPrice + productsWithoutCost} detalles pendientes`
    });
  } else {
    tips.push({
      id: 'catalog-ready',
      icon: CheckCircle,
      tone: 'success',
      title: 'Tu catalogo ya tiene mejor base de control',
      description: 'Con productos, precios y costos completos puedes tomar mejores decisiones de compra y venta.',
      action: 'Revisa cada semana si algun costo cambio con tus proveedores.',
      route: '/productos?tab=list',
      metric: `${menu.length} productos`
    });
  }

  if (customers.length < 3) {
    tips.push({
      id: 'customer-capture',
      icon: Users,
      tone: 'info',
      title: 'Empieza a registrar clientes frecuentes',
      description: 'Aunque vendas en local, guardar clientes te ayuda a recordar deudas, preferencias y recompra.',
      action: 'Registra nombre y telefono de tus clientes frecuentes o con credito.',
      route: '/clientes?tab=add',
      metric: `${customers.length} clientes`
    });
  } else {
    tips.push({
      id: 'customer-followup',
      icon: Users,
      tone: 'success',
      title: 'Aprovecha tu base de clientes',
      description: 'Ya tienes clientes registrados. Puedes usarlos para seguimiento, cobranza sana o promociones.',
      action: 'Identifica quien no compra desde hace dias y prepara un mensaje simple.',
      route: '/clientes?tab=list',
      metric: `${customers.length} clientes`
    });
  }

  if (wasteLogs.length > 0) {
    tips.push({
      id: 'waste-control',
      icon: ShieldCheck,
      tone: 'warning',
      title: 'Convierte las mermas en aprendizaje',
      description: 'Cada merma registrada debe ayudarte a ajustar produccion, compras o porciones.',
      action: 'Revisa que producto se repite mas en merma y reduce preparacion o compra.',
      route: '/ventas?tab=waste',
      metric: `${wasteLogs.length} mermas`
    });
  } else if (productsWithoutStock > 0) {
    tips.push({
      id: 'stock-review',
      icon: Package,
      tone: 'info',
      title: 'Revisa productos sin stock',
      description: 'Hay productos que podrian estar sin existencia o sin inventario configurado.',
      action: 'Actualiza stock inicial o desactiva temporalmente productos que no vendes.',
      route: '/productos?tab=list',
      metric: `${productsWithoutStock} sin stock`
    });
  }

  tips.push({
    id: 'pro-upgrade',
    icon: Lock,
    tone: 'pro',
    title: 'Analisis avanzado disponible en Pro',
    description: 'Cuando actives Pro, Lanzo podra analizar inventario, finanzas y clientes con mas contexto del negocio.',
    action: 'Usa estos consejos gratis mientras decides si necesitas analisis mas profundo.',
    route: '/configuracion',
    metric: 'IA Pro'
  });

  return tips.slice(0, 5);
};

export default function BusinessTips({
  sales = EMPTY_ARRAY,
  menu = EMPTY_ARRAY,
  customers = EMPTY_ARRAY,
  wasteLogs = EMPTY_ARRAY,
  activeRubros = EMPTY_ARRAY,
  onNavigate
}) {
  const tips = useMemo(() => buildLocalTips({ sales, menu, customers, wasteLogs, activeRubros }), [sales, menu, customers, wasteLogs, activeRubros]);
  const totalRevenue = useMemo(() => sales.reduce((sum, sale) => sum + getSaleTotal(sale), 0), [sales]);
  const warningCount = useMemo(() => tips.filter((tip) => tip.tone === 'warning').length, [tips]);

  const handleNavigate = (route) => {
    if (!route) return;
    if (onNavigate) {
      onNavigate(route);
      return;
    }
    window.location.assign(route);
  };

  return (
    <section className="business-tips-panel">
      <div className="business-tips-header">
        <div className="business-tips-title-group">
          <span className="business-tips-kicker">
            <Lightbulb size={15} />
            Consejos Lan
          </span>
          <h2>Lectura rapida del negocio</h2>
          <p>Recomendaciones simples con tus ventas, inventario y clientes actuales.</p>
        </div>

        <div className={`business-tips-status ${warningCount > 0 ? 'has-warning' : 'is-stable'}`}>
          <span>{warningCount > 0 ? `${warningCount} aviso${warningCount > 1 ? 's' : ''}` : 'Sin avisos criticos'}</span>
        </div>
      </div>

      <div className="business-tips-metrics" aria-label="Resumen del negocio">
        <div className="business-tips-metric">
          <span>Ventas</span>
          <strong>{sales.length}</strong>
        </div>
        <div className="business-tips-metric">
          <span>Ingresos</span>
          <strong>{currencyFormatter.format(totalRevenue)}</strong>
        </div>
        <div className="business-tips-metric">
          <span>Productos</span>
          <strong>{menu.length}</strong>
        </div>
        <div className="business-tips-metric">
          <span>Clientes</span>
          <strong>{customers.length}</strong>
        </div>
      </div>

      <div className="business-tips-feed">
        {tips.map(tip => {
          const Icon = tip.icon || Sparkles;
          return (
            <article key={tip.id} className={`business-tip-row tone-${tip.tone}`}>
              <div className="business-tip-icon" aria-hidden="true">
                <Icon size={18} />
              </div>

              <div className="business-tip-content">
                <div className="business-tip-copy">
                  <h3>{tip.title}</h3>
                  <p>{tip.description}</p>
                </div>

                <div className="business-tip-action">
                  <CheckCircle size={15} />
                  <span>{tip.action}</span>
                </div>
              </div>

              <div className="business-tip-meta">
                <span className="business-tip-metric">{tip.metric}</span>
                {tip.route && (
                  <button type="button" className="business-tip-button" onClick={() => handleNavigate(tip.route)}>
                    Abrir
                    <ArrowRight size={14} />
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
