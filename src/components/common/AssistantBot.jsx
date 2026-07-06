// src/components/common/AssistantBot.jsx (V5.0 - CON WEB WORKER)

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { getSmartContext, getQuickActions, GLOBAL_ALERT, getCriticalAlert, initializeGlobalAlert } from '../../config/botContext';
import {
  X, Wrench, AlertTriangle, ExternalLink, Send,
  Sparkles, HelpCircle, Lightbulb, MapPin, MessageSquareText,
  ShoppingCart, Package, BarChart3, Users, Settings, ClipboardList,
  WalletCards,
} from 'lucide-react';
import './AssistantBot.css';

import { useActiveOrders } from '../../hooks/pos/useActiveOrders';
import { useProductStore } from '../../store/useProductStore';
import { useAppStore } from '../../store/useAppStore';
import { useStatsStore } from '../../store/useStatsStore';
import { normalizeBusinessTypes } from '../../utils/businessType';

import { useBotWorker } from '../../hooks/useBotWorker';

// ─── SELECTORES ESTABLES (fuera del componente) ──────────────────────────────
// Definirlos fuera evita que se recreen en cada render del componente

const selectOrder = (state) => (
  state.currentOrderId ? state.activeOrders.get(state.currentOrderId)?.items : undefined
);
const selectStats = (state) => state.stats;
const selectLicense = (state) => state.licenseDetails;
const selectCompanyProfile = (state) => state.companyProfile;

// Calcula el total directamente del estado en lugar de llamar a getTotalPrice
// Esto evita suscribirse a una función inestable
const selectCartTotal = (state) =>
  (state.currentOrderId ? state.activeOrders.get(state.currentOrderId)?.items || [] : []).reduce((sum, item) => {
    if (item.quantity > 0) return sum + item.price * item.quantity;
    return sum;
  }, 0);

// Selector que cuenta productos con bajo stock DENTRO del selector
// Solo re-renderiza cuando el conteo cambia, no cuando cambia cualquier producto
const selectLowStockCount = (state) =>
  state.menu.filter(
    (p) => p.trackStock && p.isActive && p.stock <= (p.minStock || 0)
  ).length;

const selectProductCount = (state) => state.menu.filter((p) => p.isActive).length;

const BUSINESS_LABELS = {
  abarrotes: 'Abarrotes',
  farmacia: 'Farmacia',
  'food_service': 'Restaurante',
  'verduleria/fruteria': 'Frutas y verduras',
  apparel: 'Ropa y calzado',
  hardware: 'Ferreteria',
};

const MXN_FORMATTER = new Intl.NumberFormat('es-MX', {
  style: 'currency',
  currency: 'MXN',
  maximumFractionDigits: 2,
});

const PAGE_CONTEXTS = [
  {
    match: (path) => path === '/' || path.startsWith('/pos'),
    key: 'pos',
    label: 'Punto de venta',
    icon: ShoppingCart,
  },
  {
    match: (path) => path.startsWith('/productos'),
    key: 'productos',
    label: 'Productos e inventario',
    icon: Package,
  },
  {
    match: (path) => path.startsWith('/ventas'),
    key: 'ventas',
    label: 'Reportes del negocio',
    icon: BarChart3,
  },
  {
    match: (path) => path.startsWith('/clientes'),
    key: 'clientes',
    label: 'Clientes y cuentas',
    icon: Users,
  },
  {
    match: (path) => path.startsWith('/caja'),
    key: 'caja',
    label: 'Caja',
    icon: WalletCards,
  },
  {
    match: (path) => path.startsWith('/pedidos'),
    key: 'pedidos',
    label: 'Pedidos y cocina',
    icon: ClipboardList,
  },
  {
    match: (path) => path.startsWith('/configuracion'),
    key: 'configuracion',
    label: 'Configuracion',
    icon: Settings,
  },
];

const formatCurrency = (value = 0) => MXN_FORMATTER.format(Number(value) || 0);

const getPrimaryBusinessType = (businessType) => (
  Array.isArray(businessType) ? businessType[0] : businessType
) || 'abarrotes';

const getPageContext = (pathname) => (
  PAGE_CONTEXTS.find((item) => item.match(pathname)) || {
    key: 'default',
    label: 'Sistema Lanzo POS',
    icon: HelpCircle,
  }
);

const buildBusinessInsights = ({ pageKey, botData, productCount }) => {
  const insights = [];

  if (pageKey === 'pos') {
    if (botData.cartCount > 0) {
      insights.push(`${botData.cartCount} articulo${botData.cartCount === 1 ? '' : 's'} en venta: ${formatCurrency(botData.cartTotal)}`);
    } else {
      insights.push('Caja lista para escanear, buscar productos o iniciar una venta');
    }
  }

  if (pageKey === 'productos') {
    insights.push(`${productCount} producto${productCount === 1 ? '' : 's'} activo${productCount === 1 ? '' : 's'} en catalogo`);
  }

  if (botData.lowStockCount > 0) {
    insights.push(`${botData.lowStockCount} producto${botData.lowStockCount === 1 ? '' : 's'} con stock bajo`);
  }

  if (pageKey === 'ventas' && botData.stats?.topProduct) {
    insights.push(`Producto mas vendido: ${botData.stats.topProduct}`);
  }

  if (botData.stats?.totalDebt > 0) {
    insights.push(`Cuentas por cobrar: ${formatCurrency(botData.stats.totalDebt)}`);
  }

  if (botData.licenseDays <= 7) {
    insights.push(`Licencia por vencer en ${botData.licenseDays} dia${botData.licenseDays === 1 ? '' : 's'}`);
  }

  return insights.slice(0, 3);
};

const getContextualQuestions = ({ pageKey, businessLabel, botData }) => {
  const baseQuestions = {
    pos: [
      botData.cartCount > 0 ? 'Ayudame a revisar esta venta' : 'Como hago una venta rapida?',
      'Que productos se estan agotando?',
      'Cuanto vendi hoy?',
    ],
    productos: [
      'Como agrego un producto correctamente?',
      'Que productos tienen stock bajo?',
      businessLabel === 'Farmacia' ? 'Que productos estan por caducar?' : 'Como agrego stock?',
    ],
    ventas: [
      'Cuanto vendi hoy?',
      'Cual fue mi ganancia esta semana?',
      'Que se vende mas este mes?',
    ],
    clientes: [
      'Quien me debe dinero?',
      'Como registro un abono?',
      'Como veo el historial de un cliente?',
    ],
    caja: [
      'Como hago el corte de caja?',
      'Que hago si la caja no cuadra?',
      'Como registro una entrada o salida?',
    ],
    pedidos: [
      'Como reviso pedidos pendientes?',
      'Como marco un pedido como listo?',
      'Como uso cocina en restaurante?',
    ],
    configuracion: [
      'Como respaldo mis datos?',
      'Como sincronizo informacion?',
      'Como cambio datos del negocio?',
    ],
    default: [
      'Que puedo hacer aqui?',
      'Cuanto vendi hoy?',
      'Que productos debo revisar?',
    ],
  };

  return baseQuestions[pageKey] || baseQuestions.default;
};

const getContextualShortcuts = ({ pageKey, botData }) => {
  const shortcuts = [];

  if (botData.lowStockCount > 0) {
    shortcuts.push({ label: 'Stock bajo', path: '/ventas?tab=restock', icon: '', highlight: true });
  }

  if (botData.stats?.totalDebt > 0) {
    shortcuts.push({ label: 'Cobrar deudas', path: '/clientes', icon: '' });
  }

  if (pageKey !== 'pos') {
    shortcuts.push({ label: 'Ir a vender', path: '/', icon: '' });
  }

  if (pageKey !== 'caja') {
    shortcuts.push({ label: 'Abrir caja', path: '/caja', icon: '' });
  }

  return shortcuts;
};

// ─────────────────────────────────────────────────────────────────────────────

// Verificación de alerta global: se hace UNA vez fuera del componente
// porque GLOBAL_ALERT es una constante que nunca cambia en runtime
const ALERT_KEY = GLOBAL_ALERT?.active ? `lanzo_alert_${GLOBAL_ALERT.id}` : null;
const HAS_PENDING_ALERT =
  GLOBAL_ALERT?.active && ALERT_KEY ? !localStorage.getItem(ALERT_KEY) : false;

const AssistantBot = () => {
  const location = useLocation();
  const navigate = useNavigate();

  // ─── INTEGRACIÓN CON WEB WORKER ─────────────────────────────────────────────
  const { askBot, isReady, error: workerError } = useBotWorker();

  // ─── ESTADO LOCAL ───────────────────────────────────────────────────────────
  const [showGlobalAlert, setShowGlobalAlert] = useState(HAS_PENDING_ALERT);
  const [isOpen, setIsOpen] = useState(HAS_PENDING_ALERT);
  const [chatMode, setChatMode] = useState(false);
  const [messages, setMessages] = useState([]);
  const [userInput, setUserInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);

  const chatEndRef = useRef(null);
  const botRef = useRef(null);

  // ─── REFS para el click-outside (evita re-registrar el listener) ────────────
  const isOpenRef = useRef(isOpen);
  const showGlobalAlertRef = useRef(showGlobalAlert);

  useEffect(() => { isOpenRef.current = isOpen; }, [isOpen]);
  useEffect(() => { showGlobalAlertRef.current = showGlobalAlert; }, [showGlobalAlert]);

  // ─── SUSCRIPCIONES A STORES (selectores granulares y estables) ─────────────
  const cartOrder = useActiveOrders(selectOrder) || [];
  const cartTotal = useActiveOrders(selectCartTotal);
  const lowStockCount = useProductStore(selectLowStockCount);
  const productCount = useProductStore(selectProductCount);
  const stats = useStatsStore(selectStats);
  const licenseDetails = useAppStore(selectLicense);
  const companyProfile = useAppStore(selectCompanyProfile);

  // ─── CÁLCULOS DERIVADOS ─────────────────────────────────────────────────────

  // licenseDays: solo depende de licenseDetails, no del carrito ni productos
  const licenseDays = useMemo(() => {
    if (!licenseDetails?.expires_at) return 30;
    const diff = new Date(licenseDetails.expires_at) - new Date();
    return Math.ceil(diff / (1000 * 60 * 60 * 24));
  }, [licenseDetails?.expires_at]); // Solo se recalcula si cambia la fecha de expiración

  // botData: objeto de contexto para el bot (compatible con Worker)
  // IMPORTANTE: Solo datos serializables, no funciones ni objetos complejos
  const botData = useMemo(() => ({
    cartCount: cartOrder.length,
    cartTotal,
    lowStockCount,
    productCount,
    licenseDays,
    license: { daysRemaining: licenseDays },
    businessType: normalizeBusinessTypes(companyProfile?.business_type, 'abarrotes'),
    businessName: companyProfile?.business_name || companyProfile?.name || '',
    stats,
  }), [
    cartOrder.length, // Solo la longitud, no el array completo
    cartTotal,
    lowStockCount,
    productCount,
    licenseDays,
    companyProfile?.business_type,
    companyProfile?.business_name,
    companyProfile?.name,
    stats,
  ]);

  const pageContext = useMemo(
    () => getPageContext(location.pathname),
    [location.pathname]
  );

  const businessLabel = useMemo(() => {
    const primaryType = getPrimaryBusinessType(botData.businessType);
    return BUSINESS_LABELS[primaryType] || 'Negocio';
  }, [botData.businessType]);

  const businessInsights = useMemo(
    () => buildBusinessInsights({ pageKey: pageContext.key, botData, productCount }),
    [pageContext.key, botData, productCount]
  );

  const suggestedQuestions = useMemo(
    () => getContextualQuestions({ pageKey: pageContext.key, businessLabel, botData }),
    [pageContext.key, businessLabel, botData]
  );

  // context y criticalAlert: dependen de botData y location
  const context = useMemo(
    () => getSmartContext(location.pathname, botData),
    [location.pathname, botData]
  );

  const criticalAlert = useMemo(
    () => getCriticalAlert(botData),
    [botData]
  );

  const quickActions = useMemo(() => {
    if (context?.actions?.length > 0) return context.actions;
    const rubroType = Array.isArray(botData.businessType)
      ? botData.businessType[0]
      : 'abarrotes';
    return getQuickActions(location.pathname, rubroType);
  }, [context, location.pathname, botData.businessType]);

  const contextualShortcuts = useMemo(
    () => getContextualShortcuts({ pageKey: pageContext.key, botData }),
    [pageContext.key, botData]
  );

  const visibleActions = useMemo(() => {
    const seenTargets = new Set();
    return [...contextualShortcuts, ...quickActions]
      .filter((action) => {
        const target = action.path || action.route || action.label;
        if (seenTargets.has(target)) return false;
        seenTargets.add(target);
        return true;
      })
      .slice(0, 5);
  }, [contextualShortcuts, quickActions]);

  // ─── EFECTOS ────────────────────────────────────────────────────────────────

  // Inicializar alerta global (solo en main thread, seguro para Worker)
  useEffect(() => {
    initializeGlobalAlert();
  }, []);

  // La alerta global es una constante — solo necesitamos verificarla al montar
  // No hay dependencias que cambien en runtime
  useEffect(() => {
    if (!GLOBAL_ALERT?.active || !ALERT_KEY) {
      setShowGlobalAlert(false);
      return;
    }
    const alreadySeen = localStorage.getItem(ALERT_KEY);
    if (!alreadySeen) {
      setShowGlobalAlert(true);
      setIsOpen(true);
    }
  }, []); // [] intencional: GLOBAL_ALERT es una constante de importación

  // Auto-scroll del chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTyping]);

  // Click outside: usa refs para no re-registrar el listener en cada render
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (showGlobalAlertRef.current) return;
      if (isOpenRef.current && botRef.current && !botRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []); // [] intencional: lee estado a través de refs, nunca se re-registra

  // ─── HANDLERS (useCallback para estabilidad) ────────────────────────────────

  const handleDismissAlert = useCallback(() => {
    if (ALERT_KEY) localStorage.setItem(ALERT_KEY, 'true');
    setShowGlobalAlert(false);
    setIsOpen(false);
  }, []);

  const handleQuickAction = useCallback((action) => {
    setIsOpen(false);
    const target = action.path || action.route;
    if (target) setTimeout(() => navigate(target), 0);
  }, [navigate]);

  /**
   * Handler de envío de mensajes usando el Web Worker
   * REEMPLAZA la llamada síncrona anterior por procesamiento asíncrono
   */
  const sendMessageToBot = useCallback(async (rawInput) => {
    const currentInput = (rawInput ?? userInput).trim();
    if (!currentInput) return;

    setMessages((prev) => [
      ...prev,
      { type: 'user', text: currentInput, timestamp: Date.now() },
    ]);
    setUserInput('');
    setIsTyping(true);

    try {
      // USAR EL WEB WORKER: Llamada asíncrona sin bloquear el Event Loop
      const response = await askBot(currentInput, {
        ...botData,
        page: pageContext,
        currentPath: location.pathname,
        businessLabel,
        businessInsights,
      });

      setMessages((prev) => [
        ...prev,
        {
          type: 'bot',
          timestamp: Date.now(),
          title: response.title,
          message: response.message,
          tips: response.tips || [],
          actions: response.actions || [],
          options: response.options || [],
        },
      ]);
    } catch (error) {
       
      console.error('[AssistantBot] Error en worker:', error);

      // Mensaje de error específico según el tipo de error
      let errorMessage = 'Tuve un error procesando tu solicitud. Por favor intenta de nuevo.';

      if (error.code === 'WORKER_TIMEOUT') {
        errorMessage = 'La respuesta está tomando demasiado tiempo. Intenta con una pregunta más simple.';
      } else if (error.code === 'WORKER_NOT_INITIALIZED') {
        errorMessage = 'El asistente no está disponible. Recarga la página para intentar de nuevo.';
      } else if (!isReady) {
        errorMessage = 'El asistente está cargando. Espera un momento e intenta de nuevo.';
      }

      setMessages((prev) => [
        ...prev,
        {
          type: 'bot',
          timestamp: Date.now(),
          title: '⚠️ Error',
          message: errorMessage,
          tips: workerError ? [`Detalle técnico: ${workerError}`] : [],
          actions: [],
        },
      ]);
    } finally {
      setIsTyping(false);
    }
  }, [
    userInput,
    botData,
    pageContext,
    location.pathname,
    businessLabel,
    businessInsights,
    askBot,
    isReady,
    workerError,
  ]);

  const handleSendMessage = useCallback(() => {
    sendMessageToBot();
  }, [sendMessageToBot]);

  const handleSuggestedQuestion = useCallback((question) => {
    setChatMode(true);
    if (!isReady || isTyping) {
      setUserInput(question);
      return;
    }
    sendMessageToBot(question);
  }, [isReady, isTyping, sendMessageToBot]);

  // ─── VALORES DERIVADOS SIMPLES (sin memo, son baratos) ──────────────────────
  const hasActiveAlert =
    showGlobalAlert || criticalAlert?.severity === 'critical';
  const hasItemsInCart = cartOrder.length > 0;
  const PageIcon = pageContext.icon;

  // ─── RENDER ─────────────────────────────────────────────────────────────────
  return (
    <div
      ref={botRef}
      className={`lanzo-bot-container ${isOpen ? 'open' : 'closed'} ${hasItemsInCart ? 'has-items' : ''}`}
    >
      {isOpen && (
        <div className="lanzo-bot-card animate-pop-in">
          <div className="bot-header">
            <div className="bot-heading">
            <span className="bot-title">
              {chatMode ? (
                <><Sparkles size={16} style={{ marginRight: '6px' }} />Asistente del sistema {isReady ? '' : '(cargando...)'}</>
              ) : showGlobalAlert ? '⚠️ Importante'
                : criticalAlert ? 'Atención Requerida'
                : (context?.title || 'Lanzo Bot')}
            </span>
              {!showGlobalAlert && (
                <span className="bot-subtitle">
                  <MapPin size={12} />
                  {pageContext.label} - {businessLabel}
                </span>
              )}
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              {!showGlobalAlert && (
                <button type="button"
                  onClick={() => setChatMode(!chatMode)}
                  className="mode-toggle-btn"
                  title={chatMode ? 'Ver Contexto' : 'Preguntar al Asistente'}
                >
                  {chatMode ? <HelpCircle size={16} /> : <Sparkles size={16} />}
                </button>
              )}
              <button type="button"
                onClick={() => { if (!showGlobalAlert) setIsOpen(false); }}
                className="close-btn"
                style={showGlobalAlert ? { opacity: 0.3, cursor: 'not-allowed' } : {}}
                title={showGlobalAlert ? 'Debes leer el mensaje primero' : 'Cerrar'}
              >
                <X size={16} />
              </button>
            </div>
          </div>

          <div className="bot-body">
            {!showGlobalAlert && (
              <div className="bot-context-strip" aria-label="Contexto actual del asistente">
                <div className="context-chip">
                  <PageIcon size={14} />
                  <span>{pageContext.label}</span>
                </div>
                <div className="context-chip">
                  <Package size={14} />
                  <span>{businessLabel}</span>
                </div>
              </div>
            )}
            {showGlobalAlert ? (
              <div className="alert-content">
                <p className="alert-text">{GLOBAL_ALERT.message}</p>
                {GLOBAL_ALERT.actionLink && (
                  <button type="button"
                    onClick={() => {
                      navigate(GLOBAL_ALERT.actionLink);
                      handleDismissAlert();
                    }}
                    className="action-btn"
                  >
                    <Wrench size={16} style={{ marginRight: 5 }} />
                    Ir Ahora
                  </button>
                )}
                <button type="button" onClick={handleDismissAlert} className="dismiss-link">
                  Entendido
                </button>
              </div>
            ) : chatMode ? (
              <div className="chat-container">
                <div className="chat-messages">
                  {messages.length === 0 ? (
                    <div className="chat-welcome">
                      <Sparkles size={32} style={{ color: 'var(--primary-color)' }} />
                      <h4>Asistente del sistema</h4>
                      <p>Puedo ayudarte con acciones, reportes y dudas de esta pantalla.</p>
                      <p className="chat-context-note">
                        Contexto actual: {pageContext.label} - {businessLabel}.
                      </p>
                      <div className="suggested-questions">
                        {suggestedQuestions.map((question, index) => (
                          <button
                            type="button"
                            key={question}
                            className={index === 0 ? 'recommended' : ''}
                            onClick={() => handleSuggestedQuestion(question)}
                          >
                            <MessageSquareText size={14} />
                            {question}
                          </button>
                        ))}
                      </div>
                      {!isReady && (
                        <div style={{ marginTop: '16px', fontSize: '0.85rem', color: '#666' }}>
                          ⏳ Inicializando motor de procesamiento...
                        </div>
                      )}
                    </div>
                  ) : (
                    <>
                      {messages.map((msg) => (
                        <div key={`${msg.timestamp}-${msg.type}-${msg.title || msg.text || msg.message}`} className={`chat-message ${msg.type}`}>
                          {msg.type === 'bot' && (
                            <div className="message-avatar"><Sparkles size={14} /></div>
                          )}
                          <div className="message-bubble">
                            {msg.title && (
                              <strong style={{ display: 'block', marginBottom: '5px', color: 'var(--primary-color)' }}>
                                {msg.title}
                              </strong>
                            )}
                            <p style={{ whiteSpace: 'pre-line', margin: 0 }}>
                              {msg.message || msg.text}
                            </p>
                            {msg.tips?.length > 0 && (
                              <div className="message-tips" style={{ marginTop: '8px', fontSize: '0.9em', color: '#666', background: 'rgba(0,0,0,0.03)', padding: '8px', borderRadius: '4px' }}>
                                {msg.tips.map((tip) => (
                                  <div key={tip} style={{ display: 'flex', gap: '4px', marginBottom: '2px' }}>
                                    <Lightbulb size={12} style={{ minWidth: '12px', marginTop: '2px' }} />
                                    <span>{tip}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                            {msg.actions?.length > 0 && (
                              <div className="message-actions" style={{ marginTop: '8px', display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
                                {msg.actions.map((act) => (
                                  <button type="button"
                                    key={act.path || act.route || act.label}
                                    className={`inline-action-btn ${act.highlight ? 'highlight' : ''}`}
                                    onClick={() => handleQuickAction(act)}
                                  >
                                    {typeof act.icon === 'string' ? act.icon : ''} {act.label}
                                  </button>
                                ))}
                              </div>
                            )}
                            {msg.options?.length > 0 && (
                              <div className="message-options">
                                {msg.options.map((opt) => (
                                  <button type="button" key={opt.query || opt.label} className="option-btn" onClick={() => setUserInput(opt.query)}>
                                    {opt.label}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                      {isTyping && (
                        <div className="chat-message bot">
                          <div className="message-avatar"><Sparkles size={14} /></div>
                          <div className="message-bubble typing">
                            <span /><span /><span />
                          </div>
                        </div>
                      )}
                      <div ref={chatEndRef} />
                    </>
                  )}
                </div>
                <div className="chat-input-wrapper">
                  <input
                    type="text"
                    className="chat-input"
                    placeholder={isReady ? "Escribe tu pregunta..." : "Cargando asistente..."}
                    aria-label="Pregunta para el asistente"
                    value={userInput}
                    onChange={(e) => setUserInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                    disabled={!isReady || isTyping}
                  />
                  <button type="button"
                    className="send-btn"
                    onClick={handleSendMessage}
                    disabled={!userInput.trim() || !isReady || isTyping}
                  >
                    <Send size={18} color="#ffffff" strokeWidth={2} />
                  </button>
                </div>
              </div>
            ) : (
              <>
                {criticalAlert ? (
                  <div className="critical-alert-card" style={{
                    backgroundColor: criticalAlert.severity === 'critical' ? '#ffebee' : '#fff3e0',
                    padding: '12px', borderRadius: '8px', marginBottom: '12px',
                    border: `1px solid ${criticalAlert.severity === 'critical' ? '#ffcdd2' : '#ffe0b2'}`
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: criticalAlert.severity === 'critical' ? '#d32f2f' : '#e65100', fontWeight: 'bold', marginBottom: '4px' }}>
                      <AlertTriangle size={16} />
                      <span>{criticalAlert.type === 'license' ? 'Licencia' : 'Alerta'}</span>
                    </div>
                    <p style={{ fontSize: '14px', margin: '0 0 8px 0', color: '#333' }}>
                      {criticalAlert.message}
                    </p>
                    {criticalAlert.action && (
                      <button type="button"
                        onClick={() => handleQuickAction({ path: criticalAlert.action.route || criticalAlert.action.path })}
                        className="critical-alert-action-btn"
                      >
                        {criticalAlert.action.label} <ExternalLink size={10} />
                      </button>
                    )}
                  </div>
                ) : null}
                <p className="bot-message">{context?.message || '¿En qué puedo ayudarte hoy?'}</p>
                {businessInsights.length > 0 && (
                  <div className="business-insights" aria-label="Resumen rapido del negocio">
                    {businessInsights.map((insight) => (
                      <div key={insight} className="business-insight">
                        <Lightbulb size={13} />
                        <span>{insight}</span>
                      </div>
                    ))}
                  </div>
                )}
                {context?.tips?.length > 0 && (
                  <div className="bot-tips">
                    {context.tips.map((tip) => (
                      <div key={tip} className="tip-item">
                        <Lightbulb size={14} />
                        <span>{tip}</span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          {!chatMode && !showGlobalAlert && visibleActions.length > 0 && (
            <div className="bot-actions">
              <div className="bot-actions-header">Atajos utiles aqui</div>
              {visibleActions.map((action) => (
                <button type="button"
                  key={action.path || action.route || action.label}
                  className="quick-action-btn"
                  onClick={() => handleQuickAction(action)}
                >
                  {action.icon && <span className="action-icon">{action.icon}</span>}
                  <span className="action-label">{action.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {!isOpen && (
        <button type="button"
          onClick={() => setIsOpen(true)}
          className={`lanzo-bot-fab ${hasActiveAlert ? 'pulse' : ''}`}
          title={hasActiveAlert ? 'Tienes una alerta importante' : 'Abrir asistente'}
        >
          {hasActiveAlert ? (
            <AlertTriangle size={24} color="#fff" />
          ) : (
            <img
              src="/boticon.svg"
              alt="Bot"
              width="28"
              height="28"
            />
          )}
        </button>
      )}
    </div>
  );
};

export default AssistantBot;
