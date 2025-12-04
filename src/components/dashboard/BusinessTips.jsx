// src/components/dashboard/BusinessTips.jsx
import React, { useMemo, useState } from 'react';
import { 
  Star, TrendingUp, AlertTriangle, Lightbulb, DollarSign, Package, Users, // <--- Agregado 'Star' aquí
  Target, Zap, Clock, ChefHat, Percent, Activity, CheckCircle, Info, BrainCircuit
} from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { useSalesStore } from '../../store/useSalesStore';

// ============================================================
// 🧠 MOTOR DE INTELIGENCIA DE NEGOCIOS (BI ENGINE v3)
// ============================================================

function analyzeBusinessData(sales, menu, customers, wasteLogs, businessType) {
  const tips = [];
  const now = new Date();
  
  // ------------------------------------------------------------
  // 1. NIVEL 0: ARRANQUE EN FRÍO (0 Ventas)
  // ------------------------------------------------------------
  if (sales.length === 0) {
    return [{
      id: 'welcome', type: 'intro', icon: 'Zap', priority: 1,
      title: '🚀 Iniciando Motores',
      message: 'El sistema de inteligencia está activo y esperando datos. Registra tu primera venta para comenzar el análisis.',
      action: { label: 'Ir al Punto de Venta', link: '/' }
    }];
  }

  // ------------------------------------------------------------
  // 2. PREPARACIÓN DE MÉTRICAS
  // ------------------------------------------------------------
  const totalRevenue = sales.reduce((sum, s) => sum + (s.total || 0), 0);
  
  // Detectar calidad de datos (Costos en 0)
  let productsWithoutCost = 0;
  let totalItemsCount = 0;
  let totalCost = 0;

  // Mapa de rendimiento
  const productStats = new Map();

  sales.forEach(sale => {
    sale.items?.forEach(item => {
        totalItemsCount++;
        const itemCost = item.cost || 0;
        if (itemCost === 0) productsWithoutCost++;
        
        totalCost += (itemCost * item.quantity);

        // Agrupar por producto
        const id = item.parentId || item.id;
        const current = productStats.get(id) || { qty: 0, revenue: 0, name: item.name };
        productStats.set(id, {
            qty: current.qty + item.quantity,
            revenue: current.revenue + ((item.price || 0) * item.quantity),
            name: item.name
        });
    });
  });

  const globalProfit = totalRevenue - totalCost;
  const globalMargin = totalRevenue > 0 ? (globalProfit / totalRevenue) * 100 : 0;
  const missingCostPercentage = totalItemsCount > 0 ? (productsWithoutCost / totalItemsCount) * 100 : 0;

  // ------------------------------------------------------------
  // 3. NIVEL APRENDIZ (Pocas ventas o Datos incompletos)
  // ------------------------------------------------------------
  
  // A. ALERTA DE CALIDAD DE DATOS (Crítico para que funcione la inteligencia)
  if (missingCostPercentage > 30) {
      tips.push({
          id: 'missing-costs', type: 'warning', icon: 'DollarSign', priority: 1,
          title: '⚠️ Calibración de Ganancias Requerida',
          message: `El ${missingCostPercentage.toFixed(0)}% de tus productos vendidos tienen costo $0. No puedo calcular tu ganancia real ni darte consejos financieros precisos.`,
          suggestions: ['Edita tus productos y agrega el "Costo de Compra".', 'Usa la herramienta "Reparar Ganancias" en Configuración después.'],
          action: { label: 'Editar Productos', link: '/productos' }
      });
  }

  // B. MODO APRENDIZAJE (< 10 Ventas)
  if (sales.length < 10) {
      const salesNeeded = 10 - sales.length;
      tips.push({
          id: 'learning-mode', type: 'info', icon: 'BrainCircuit', priority: 2,
          title: '🧠 Calibrando Algoritmo...',
          message: `He analizado ${sales.length} ventas. Necesito aproximadamente ${salesNeeded} más para detectar tendencias confiables y horas pico.`,
          suggestions: ['Sigue operando con normalidad.', 'Asegúrate de registrar todas las salidas de mercancía.']
      });
      
      // Aunque esté aprendiendo, mostramos lo básico si hay algo destacado
      const topProduct = Array.from(productStats.values()).sort((a,b) => b.qty - a.qty)[0];
      if (topProduct) {
          tips.push({
              id: 'early-winner', type: 'success', icon: 'Star', priority: 3,
              title: `Tendencia Temprana: "${topProduct.name}"`,
              message: `Es lo que más se mueve hasta ahora (${topProduct.qty} unidades). Mantenlo vigilado.`
          });
      }

      // IMPORTANTE: Retornamos aquí para no ejecutar lógica avanzada con pocos datos
      return tips.sort((a, b) => a.priority - b.priority);
  }

  // ------------------------------------------------------------
  // 4. NIVEL EXPERTO (Análisis profundo con datos suficientes)
  // ------------------------------------------------------------

  // --- ANÁLISIS POR RUBRO ---

  // 🥘 RESTAURANTES (Food Service)
  if (businessType.some(t => t.includes('food') || t.includes('restaurante'))) {
    // Merma vs Venta
    const totalWaste = wasteLogs.reduce((sum, w) => sum + (w.lossAmount || 0), 0);
    const wasteRatio = totalRevenue > 0 ? (totalWaste / totalRevenue) * 100 : 0;

    if (wasteRatio > 4) {
      tips.push({
        id: 'high-waste', type: 'danger', icon: 'ChefHat', priority: 2,
        title: `🚨 Alerta de Cocina: Merma Alta (${wasteRatio.toFixed(1)}%)`,
        message: `Estás perdiendo $${totalWaste.toFixed(2)} en desperdicios. En cocina, superar el 4% afecta directamente tu utilidad.`,
        action: { label: 'Revisar Mermas', link: '/ventas' }
      });
    } else if (wasteLogs.length === 0 && sales.length > 50) {
        // Sospecha: ¿Nunca se les cae nada?
        tips.push({
            id: 'no-waste-suspicion', type: 'info', icon: 'AlertTriangle', priority: 10,
            title: '¿Cero desperdicios?',
            message: 'No has registrado ninguna merma en 50 ventas. Es inusual en cocina. Asegúrate de que el personal esté reportando los errores o caducados.'
        });
    }
  }

  // 💊 RETAIL / FARMACIA (Inventario Estancado)
  if (businessType.some(t => ['farmacia', 'abarrotes', 'tienda', 'apparel', 'hardware'].includes(t))) {
      // Stock Muerto (Sin movimiento en 30 días)
      // Nota: Esto requiere que los productos tengan 'updatedAt' o ventas recientes. 
      // Simplificamos buscando productos con stock > 0 que no están en las ventas recientes.
      let deadStockCount = 0;
      let deadStockMoney = 0;
      
      menu.forEach(p => {
          if (p.stock > 0 && !productStats.has(p.id)) {
              deadStockCount++;
              deadStockMoney += (p.cost * p.stock);
          }
      });

      if (deadStockMoney > 2000) { // Umbral de dinero parado
          tips.push({
              id: 'dead-stock', type: 'warning', icon: 'Package', priority: 3,
              title: `🧊 Dinero Congelado: $${deadStockMoney.toFixed(0)}`,
              message: `Tienes ${deadStockCount} productos con stock que no se han vendido en este periodo.`,
              suggestions: ['Arma una liquidación.', 'Ponlos cerca de la caja.', 'Revisa si el precio está mal.']
          });
      }
  }

  // --- ANÁLISIS FINANCIERO ---

  // Producto "Falso Amigo" (Alto Volumen, Margen Mínimo)
  let falseFriend = null;
  productStats.forEach((stat, id) => {
      const prod = menu.find(p => p.id === id);
      if (prod && prod.price > 0 && prod.cost > 0) {
          const margin = (prod.price - prod.cost) / prod.price;
          // Si vende mucho (top 20%) y gana poco (< 15%)
          if (stat.qty > 10 && margin < 0.15) falseFriend = prod;
      }
  });

  if (falseFriend) {
      tips.push({
          id: 'false-friend', type: 'warning', icon: 'Activity', priority: 4,
          title: `⚖️ Revisa el precio de: "${falseFriend.name}"`,
          message: 'Se vende mucho, pero deja menos del 15% de ganancia. Estás trabajando casi gratis con este ítem.',
          suggestions: [`Sube el precio ligeramente (ej. $${(falseFriend.price * 1.1).toFixed(0)}).`, 'Negocia costo con proveedor.']
      });
  }

  // Clientes Perdidos (Churn) - Solo si hay historial suficiente
  if (customers.length > 5 && sales.length > 30) {
      // Lógica simple: Cliente con compras antiguas pero no recientes
      // (Requiere que el objeto customer tenga lastPurchaseDate actualizado, asumimos que se actualiza al vender)
      const lostVip = customers.find(c => c.totalSpent > 500 && (!c.lastPurchaseDate || new Date(c.lastPurchaseDate) < new Date(now - 45 * 24 * 60 * 60 * 1000)));
      
      if (lostVip) {
          tips.push({
              id: 'lost-vip', type: 'info', icon: 'Users', priority: 5,
              title: '💔 Cliente VIP Ausente',
              message: `${lostVip.name} solía comprar pero no viene hace tiempo.`,
              suggestions: ['Envíale un mensaje para saludar.', 'Ofrécele una promo de retorno.']
          });
      }
  }

  // ------------------------------------------------------------
  // 5. RED DE SEGURIDAD (Si todo está bien)
  // ------------------------------------------------------------
  if (tips.length === 0) {
      if (globalMargin > 20) {
          tips.push({
              id: 'all-good', type: 'success', icon: 'CheckCircle', priority: 1,
              title: '✅ Salud del Negocio: Excelente',
              message: `Tu margen global es del ${globalMargin.toFixed(1)}%. No detecto fugas de dinero ni problemas de stock urgentes.`,
              suggestions: ['¡Sigue así!', 'Es buen momento para pensar en expandir el catálogo.']
          });
      } else {
          tips.push({
              id: 'margin-focus', type: 'info', icon: 'Target', priority: 1,
              title: '💡 Objetivo: Mejorar Margen',
              message: `Tu margen global es ${globalMargin.toFixed(1)}%. Para subirlo, intenta vender más productos complementarios (bebidas, accesorios, extras).`
          });
      }
  }

  return tips.sort((a, b) => a.priority - b.priority);
}

// ============================================================
// COMPONENTE VISUAL
// ============================================================

export default function BusinessTips({ sales, menu, customers }) {
  const [expandedTip, setExpandedTip] = useState(null);
  
  // Contextos
  const wasteLogs = useSalesStore(state => state.wasteLogs);
  const companyProfile = useAppStore(state => state.companyProfile);
  
  const businessType = useMemo(() => {
    let types = companyProfile?.business_type || [];
    if (typeof types === 'string') types = types.split(',').map(s => s.trim().toLowerCase());
    return types;
  }, [companyProfile]);

  const tips = useMemo(() => 
    analyzeBusinessData(sales || [], menu || [], customers || [], wasteLogs || [], businessType), 
    [sales, menu, customers, wasteLogs, businessType]
  );

  const getIcon = (iconName) => {
    const icons = {
      Star, TrendingUp, AlertTriangle, Lightbulb, DollarSign, Package, Users, 
      Target, Zap, Clock, ChefHat, Percent, Activity, CheckCircle, Info, BrainCircuit
    };
    const Icon = icons[iconName] || Lightbulb;
    return <Icon size={24} />;
  };

  const getTypeStyles = (type) => {
    const styles = {
      success: { bg: 'linear-gradient(135deg, #10b981 0%, #059669 100%)', border: '#059669', text: 'white' },
      warning: { bg: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)', border: '#d97706', text: 'white' }, // Ámbar fuerte
      danger:  { bg: 'linear-gradient(135deg, #ef4444 0%, #b91c1c 100%)', border: '#b91c1c', text: 'white' },
      info:    { bg: 'var(--card-background-color)', border: 'var(--secondary-color)', text: 'var(--text-dark)' }, // Info es sutil (fondo tarjeta)
      intro:   { bg: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)', border: '#4f46e5', text: 'white' }
    };
    return styles[type] || styles.info;
  };

  return (
    <div style={{
      backgroundColor: 'var(--card-background-color)',
      borderRadius: '16px',
      padding: '1.5rem',
      boxShadow: 'var(--box-shadow)',
      border: '1px solid var(--border-color)',
      animation: 'fadeIn 0.5s ease-out'
    }}>
      <h3 className="subtitle" style={{marginBottom: '1.5rem', borderBottom: 'none', display:'flex', alignItems:'center', gap:'10px'}}>
        Inteligencia LANZO - Negocio
        {tips.length > 0 && tips[0].id === 'learning-mode' && (
            <span style={{fontSize:'0.7rem', backgroundColor:'#e0e7ff', color:'#4338ca', padding:'2px 8px', borderRadius:'10px'}}>
                Aprendiendo...
            </span>
        )}
      </h3>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {tips.map((tip) => {
          const isExpanded = expandedTip === tip.id;
          const style = getTypeStyles(tip.type);
          
          // Ajuste visual para el modo 'info' que tiene fondo claro
          const isLightBg = tip.type === 'info'; 
          
          return (
            <div
              key={tip.id}
              style={{
                background: style.bg,
                color: style.text,
                borderRadius: '12px',
                padding: '1.25rem',
                boxShadow: isLightBg ? 'none' : '0 4px 12px rgba(0,0,0,0.15)',
                cursor: tip.suggestions ? 'pointer' : 'default',
                transition: 'all 0.2s ease',
                border: `1px solid ${isLightBg ? 'var(--border-color)' : style.border}`,
                borderLeft: isLightBg ? `5px solid ${style.border}` : `1px solid ${style.border}`,
                position: 'relative',
                overflow: 'hidden'
              }}
              onClick={() => tip.suggestions && setExpandedTip(isExpanded ? null : tip.id)}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '1rem', position: 'relative', zIndex: 2 }}>
                <div style={{
                  backgroundColor: isLightBg ? 'var(--light-background)' : 'rgba(255,255,255,0.2)',
                  color: isLightBg ? 'var(--secondary-color)' : 'white',
                  borderRadius: '10px',
                  padding: '0.6rem',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0
                }}>
                  {getIcon(tip.icon)}
                </div>
                
                <div style={{ flex: 1 }}>
                  <h4 style={{ margin: '0 0 0.3rem 0', fontSize: '1.05rem', fontWeight: '700', lineHeight: '1.3' }}>
                    {tip.title}
                  </h4>
                  
                  <p style={{ margin: '0', fontSize: '0.9rem', lineHeight: '1.4', opacity: 0.95 }}>
                    {tip.message}
                  </p>

                  {tip.suggestions && isExpanded && (
                    <div style={{ 
                        marginTop: '1rem', 
                        padding: '10px', 
                        backgroundColor: isLightBg ? 'var(--light-background)' : 'rgba(0,0,0,0.1)', 
                        borderRadius: '8px' 
                    }}>
                        <p style={{fontWeight:'bold', fontSize:'0.8rem', marginBottom:'5px', textTransform:'uppercase', opacity: 0.8}}>
                            Recomendaciones:
                        </p>
                        <ul style={{ margin: '0', paddingLeft: '1.2rem', listStyle: 'disc' }}>
                        {tip.suggestions.map((suggestion, idx) => (
                            <li key={idx} style={{ marginBottom: '0.4rem', fontSize: '0.9rem' }}>
                            {suggestion}
                            </li>
                        ))}
                        </ul>
                        
                        {tip.action && (
                            <button
                            onClick={(e) => { e.stopPropagation(); window.location.href = tip.action.link; }}
                            style={{
                                marginTop: '10px', width: '100%',
                                backgroundColor: isLightBg ? 'var(--secondary-color)' : 'white',
                                color: isLightBg ? 'white' : style.border,
                                border: 'none', padding: '8px', borderRadius: '6px',
                                fontWeight: '700', fontSize: '0.85rem', cursor: 'pointer'
                            }}
                            >
                            {tip.action.label} →
                            </button>
                        )}
                    </div>
                  )}

                  {tip.suggestions && !isExpanded && (
                    <div style={{ marginTop: '0.5rem', fontSize: '0.75rem', opacity: 0.8, display: 'flex', alignItems: 'center', gap: '5px' }}>
                      <span>▼ Ver detalles</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}