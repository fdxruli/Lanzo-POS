// src/components/common/AssistantBot.jsx (V4.2 - OPTIMIZADO)

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { getSmartContext, getQuickActions, GLOBAL_ALERT, getCriticalAlert } from '../../config/botContext';
import {
  X, Wrench, AlertTriangle, ExternalLink, Send,
  Sparkles, HelpCircle, Lightbulb,
} from 'lucide-react';
import './AssistantBot.css';

import { useOrderStore } from '../../store/useOrderStore';
import { useProductStore } from '../../store/useProductStore';
import { useAppStore } from '../../store/useAppStore';
import { useStatsStore } from '../../store/useStatsStore';

import {
  detectIntent,
  extractEntities,
  generateResponse,
} from '../../utils/botIntelligence';

// ─── SELECTORES ESTABLES (fuera del componente) ──────────────────────────────
// Definirlos fuera evita que se recreen en cada render del componente

const selectOrder = (state) => state.order;
const selectMenu = (state) => state.menu;
const selectStats = (state) => state.stats;
const selectLicense = (state) => state.licenseDetails;
const selectCompanyProfile = (state) => state.companyProfile;

// Calcula el total directamente del estado en lugar de llamar a getTotalPrice
// Esto evita suscribirse a una función inestable
const selectCartTotal = (state) =>
  state.order.reduce((sum, item) => {
    if (item.quantity > 0) return sum + item.price * item.quantity;
    return sum;
  }, 0);

// Selector que cuenta productos con bajo stock DENTRO del selector
// Solo re-renderiza cuando el conteo cambia, no cuando cambia cualquier producto
const selectLowStockCount = (state) =>
  state.menu.filter(
    (p) => p.trackStock && p.isActive && p.stock <= (p.minStock || 0)
  ).length;

// ─────────────────────────────────────────────────────────────────────────────

// Verificación de alerta global: se hace UNA vez fuera del componente
// porque GLOBAL_ALERT es una constante que nunca cambia en runtime
const ALERT_KEY = GLOBAL_ALERT?.active ? `lanzo_alert_${GLOBAL_ALERT.id}` : null;
const HAS_PENDING_ALERT =
  GLOBAL_ALERT?.active && ALERT_KEY ? !localStorage.getItem(ALERT_KEY) : false;

const AssistantBot = () => {
  const location = useLocation();
  const navigate = useNavigate();

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
  const cartOrder = useOrderStore(selectOrder);
  const cartTotal = useOrderStore(selectCartTotal);
  const lowStockCount = useProductStore(selectLowStockCount);
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

  // botData: ya no incluye lowStockCount ni cartTotal (vienen de selectores propios)
  const botData = useMemo(() => ({
    cartCount: cartOrder.length,
    cartTotal,
    lowStockCount,
    licenseDays,
    license: { daysRemaining: licenseDays },
    businessType: companyProfile?.business_type || [],
    stats,
  }), [
    cartOrder.length, // Solo la longitud, no el array completo
    cartTotal,
    lowStockCount,
    licenseDays,
    companyProfile?.business_type,
    stats,
  ]);

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

  // ─── EFECTOS ────────────────────────────────────────────────────────────────

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

  const handleSendMessage = useCallback(async () => {
    if (!userInput.trim()) return;

    const currentInput = userInput;
    setMessages((prev) => [
      ...prev,
      { type: 'user', text: currentInput, timestamp: Date.now() },
    ]);
    setUserInput('');
    setIsTyping(true);

    try {
      const intent = detectIntent(currentInput);
      const entities = extractEntities(currentInput);
      entities.originalMessage = currentInput;
      const response = await generateResponse(intent, entities, botData);

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
      console.error('Error en bot intelligence:', error);
      setMessages((prev) => [
        ...prev,
        {
          type: 'bot',
          message: 'Tuve un error procesando tu solicitud. Por favor intenta de nuevo.',
          timestamp: Date.now(),
        },
      ]);
    } finally {
      setIsTyping(false);
    }
  }, [userInput, botData]);

  // ─── VALORES DERIVADOS SIMPLES (sin memo, son baratos) ──────────────────────
  const hasActiveAlert =
    showGlobalAlert || criticalAlert?.severity === 'critical';
  const hasItemsInCart = cartOrder.length > 0;

  // ─── RENDER ─────────────────────────────────────────────────────────────────
  return (
    <div
      ref={botRef}
      className={`lanzo-bot-container ${isOpen ? 'open' : 'closed'} ${hasItemsInCart ? 'has-items' : ''}`}
    >
      {isOpen && (
        <div className="lanzo-bot-card animate-pop-in">
          <div className="bot-header">
            <span className="bot-title">
              {chatMode ? (
                <><Sparkles size={16} style={{ marginRight: '6px' }} />Asistente IA</>
              ) : showGlobalAlert ? '⚠️ Importante'
                : criticalAlert ? 'Atención Requerida'
                : (context?.title || 'Lanzo Bot')}
            </span>
            <div style={{ display: 'flex', gap: '8px' }}>
              {!showGlobalAlert && (
                <button
                  onClick={() => setChatMode(!chatMode)}
                  className="mode-toggle-btn"
                  title={chatMode ? 'Ver Contexto' : 'Preguntar al Asistente'}
                >
                  {chatMode ? <HelpCircle size={16} /> : <Sparkles size={16} />}
                </button>
              )}
              <button
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
            {showGlobalAlert ? (
              <div className="alert-content">
                <p className="alert-text">{GLOBAL_ALERT.message}</p>
                {GLOBAL_ALERT.actionLink && (
                  <button
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
                <button onClick={handleDismissAlert} className="dismiss-link">
                  Entendido
                </button>
              </div>
            ) : chatMode ? (
              <div className="chat-container">
                <div className="chat-messages">
                  {messages.length === 0 ? (
                    <div className="chat-welcome">
                      <Sparkles size={32} style={{ color: 'var(--primary-color)' }} />
                      <h4>¡Hola! Soy tu asistente inteligente</h4>
                      <p>Puedo analizar tus ventas, inventario y más. Intenta con:</p>
                      <div className="suggested-questions">
                        <button onClick={() => setUserInput('¿Cuánto he vendido hoy?')}>¿Cuánto he vendido hoy?</button>
                        <button onClick={() => setUserInput('¿Qué productos tienen stock bajo?')}>¿Qué productos tienen stock bajo?</button>
                        <button onClick={() => setUserInput('¿Quién me debe dinero?')}>¿Quién me debe dinero?</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      {messages.map((msg, idx) => (
                        <div key={idx} className={`chat-message ${msg.type}`}>
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
                                {msg.tips.map((tip, tIdx) => (
                                  <div key={tIdx} style={{ display: 'flex', gap: '4px', marginBottom: '2px' }}>
                                    <Lightbulb size={12} style={{ minWidth: '12px', marginTop: '2px' }} />
                                    <span>{tip}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                            {msg.actions?.length > 0 && (
                              <div className="message-actions" style={{ marginTop: '8px', display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
                                {msg.actions.map((act, aIdx) => (
                                  <button
                                    key={aIdx}
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
                                {msg.options.map((opt, i) => (
                                  <button key={i} className="option-btn" onClick={() => setUserInput(opt.query)}>
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
                    placeholder="Escribe tu pregunta..."
                    value={userInput}
                    onChange={(e) => setUserInput(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
                  />
                  <button
                    className="send-btn"
                    onClick={handleSendMessage}
                    disabled={!userInput.trim()}
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
                      <button
                        onClick={() => handleQuickAction({ path: criticalAlert.action.route || criticalAlert.action.path })}
                        style={{ background: 'white', border: '1px solid #ddd', padding: '4px 12px', borderRadius: '4px', fontSize: '12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', fontWeight: '500' }}
                      >
                        {criticalAlert.action.label} <ExternalLink size={10} />
                      </button>
                    )}
                  </div>
                ) : (
                  <p className="context-message">{context?.message}</p>
                )}

                {quickActions?.length > 0 && (
                  <div className="bot-actions">
                    <small className="actions-label">Acciones rápidas:</small>
                    <div className="actions-grid">
                      {quickActions.map((action, idx) => (
                        <button
                          key={idx}
                          className={`quick-action-btn ${action.highlight ? 'highlight' : ''}`}
                          onClick={() => handleQuickAction(action)}
                        >
                          <span className="action-icon">{action.icon}</span>
                          <span className="action-label">{action.label}</span>
                          <ExternalLink size={12} className="action-arrow" />
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {context?.tips?.length > 0 && (
                  <div className="bot-tips">
                    <small>💡 Tips:</small>
                    <ul>
                      {context.tips.map((tip, idx) => <li key={idx}>{tip}</li>)}
                    </ul>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      <button
        className={`lanzo-bot-avatar ${hasActiveAlert ? 'has-alert' : ''} ${chatMode && isOpen ? 'chat-active' : ''}`}
        onClick={() => setIsOpen(!isOpen)}
        aria-label="Asistente Virtual"
        title={showGlobalAlert ? '⚠️ Tienes un mensaje importante' : 'Abrir asistente'}
      >
        {hasActiveAlert ? (
          <AlertTriangle size={24} color="white" />
        ) : chatMode && isOpen ? (
          <Sparkles size={24} color="white" />
        ) : (
          <img src="/boticon.svg" alt="Asistente" className="bot-icon-svg" />
        )}
        {!isOpen && (lowStockCount > 0 || licenseDays <= 7 || criticalAlert || showGlobalAlert) && (
          <span className="notification-dot" />
        )}
      </button>
    </div>
  );
};

export default AssistantBot;