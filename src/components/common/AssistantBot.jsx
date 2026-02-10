// src/components/common/AssistantBot.jsx (V4.1 - ALERTAS GLOBALES FORZADAS)

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { getSmartContext, getQuickActions, GLOBAL_ALERT, getCriticalAlert } from '../../config/botContext';
import {
  X, Wrench, AlertTriangle, ExternalLink, Send,
  Sparkles, HelpCircle, Lightbulb,
} from 'lucide-react';
import './AssistantBot.css';
// --- STORES ---
import { useOrderStore } from '../../store/useOrderStore';
import { useProductStore } from '../../store/useProductStore';
import { useAppStore } from '../../store/useAppStore';
import { useStatsStore } from '../../store/useStatsStore';

// --- NUEVA INTEGRACIÓN DE INTELIGENCIA ---
import {
  detectIntent,
  extractEntities,
  generateResponse,
  getProactiveSuggestions // (Opcional) Si quieres sugerencias proactivas
} from '../../utils/botIntelligence';

const AssistantBot = () => {
  const location = useLocation();
  const navigate = useNavigate();
  
  const checkInitialGlobalAlert = () => {
    if (GLOBAL_ALERT && GLOBAL_ALERT.active) {
      const alertKey = `lanzo_alert_${GLOBAL_ALERT.id}`;
      // Si NO existe en localStorage, es que es una alerta pendiente (true)
      return !localStorage.getItem(alertKey);
    }
    return false;
  };

  const [showGlobalAlert, setShowGlobalAlert] = useState(checkInitialGlobalAlert);
  const [isOpen, setIsOpen] = useState(checkInitialGlobalAlert);
  const [chatMode, setChatMode] = useState(false);
  const [messages, setMessages] = useState([]);
  const [userInput, setUserInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const chatEndRef = useRef(null);

  // 1. LEER ESTADO DE LA APP
  const cartOrder = useOrderStore((state) => state.order);
  const getTotalPrice = useOrderStore((state) => state.getTotalPrice);
  const menuProducts = useProductStore((state) => state.menu);
  const stats = useStatsStore((state) => state.stats);
  const licenseDetails = useAppStore((state) => state.licenseDetails);
  const companyProfile = useAppStore((state) => state.companyProfile);

  const showAssistantBot = useAppStore((state) => state.showAssistantBot);

  // 2. CÁLCULOS DERIVADOS Y DATA PARA EL BOT
  const botData = useMemo(() => {
    const lowStockCount = menuProducts.filter(p =>
      p.trackStock && p.isActive && p.stock <= (p.minStock || 0)
    ).length;

    let licenseDays = 30;
    if (licenseDetails?.expires_at) {
      const diff = new Date(licenseDetails.expires_at) - new Date();
      licenseDays = Math.ceil(diff / (1000 * 60 * 60 * 24));
    }

    return {
      cartCount: cartOrder.length,
      cartTotal: getTotalPrice(),
      lowStockCount,
      licenseDays,
      products: menuProducts,
      license: { daysRemaining: licenseDays },
      businessType: companyProfile?.business_type || [],
      stats
    };
  }, [cartOrder, menuProducts, stats, licenseDetails, getTotalPrice, companyProfile]);

  // 2.5 🆕 VERIFICACIÓN DE ALERTA GLOBAL (PRIORITARIA)
  // Esto asegura que las alertas críticas SIEMPRE se muestren, 
  // incluso si el usuario desactivó el bot en configuración
  useEffect(() => {
    if (GLOBAL_ALERT.active) {
      const alertKey = `lanzo_alert_${GLOBAL_ALERT.id}`;
      const seenAlert = localStorage.getItem(alertKey);
      
      if (!seenAlert) {
        console.log('🔔 [AssistantBot] Alerta global detectada.');
        setShowGlobalAlert(true);
        setIsOpen(true);
      }
    } else {
      setShowGlobalAlert(false);
    }
  }, [GLOBAL_ALERT.active, GLOBAL_ALERT.id]);

  // 3. OBTENER CONTEXTO INTELIGENTE (Visualización pasiva)
  const context = useMemo(() => {
    return getSmartContext(location.pathname, botData);
  }, [location.pathname, botData]);

  // 4. OBTENER ALERTA CRÍTICA
  const criticalAlert = useMemo(() => {
    return getCriticalAlert(botData);
  }, [botData]);

  // 5. OBTENER ACCIONES RÁPIDAS
  const quickActions = useMemo(() => {
    if (context?.actions && context.actions.length > 0) {
      return context.actions;
    }
    const rubroType = Array.isArray(botData.businessType)
      ? botData.businessType[0]
      : 'abarrotes';
    return getQuickActions(location.pathname, rubroType);
  }, [context, location.pathname, botData.businessType]);

  // Auto-scroll del chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTyping]);

  const handleDismissAlert = () => {
    // Guardar que el usuario ya vio esta alerta específica
    localStorage.setItem(`lanzo_alert_${GLOBAL_ALERT.id}`, 'true');
    
    setShowGlobalAlert(false);
    setIsOpen(false);
    
    console.log('✅ [AssistantBot] Alerta global marcada como vista');
  };

  const handleQuickAction = (action) => {
    setIsOpen(false);
    setTimeout(() => {
      // Soporte para ambas propiedades (path o route)
      const target = action.path || action.route;
      if (target) navigate(target);
    }, 0);
  };

  // --- LÓGICA DE PROCESAMIENTO NUEVA ---
  const handleSendMessage = async () => {
    if (!userInput.trim()) return;

    const currentInput = userInput;
    const userMessage = { type: 'user', text: currentInput, timestamp: Date.now() };

    setMessages(prev => [...prev, userMessage]);
    setUserInput('');
    setIsTyping(true);

    try {
      const intent = detectIntent(userInput);
      const entities = extractEntities(userInput, menuProducts);
      entities.originalMessage = userInput;
      const response = await generateResponse(intent, entities, botData);

      // 4. Formatear para el chat
      const botMessage = {
        type: 'bot',
        timestamp: Date.now(),
        // Mapeamos la estructura de botIntelligence a lo que usa el render
        title: response.title,
        message: response.message,
        tips: response.tips || [],
        actions: response.actions || [], // Ahora es un array
        options: response.options || [] // Por si devuelve opciones de menú
      };

      setMessages(prev => [...prev, botMessage]);
    } catch (error) {
      console.error("Error en bot intelligence:", error);
      setMessages(prev => [...prev, {
        type: 'bot',
        message: 'Tuve un error procesando tu solicitud. Por favor intenta de nuevo.',
        timestamp: Date.now()
      }]);
    } finally {
      setIsTyping(false);
    }
  };

  const handleSuggestedQuestion = (query) => {
    setUserInput(query);
    // Usamos setTimeout para asegurar que el estado se actualice antes de enviar
    setTimeout(() => {
      // Truco: llamamos a una función interna o forzamos el evento, 
      // pero como handleSendMessage usa el estado userInput, 
      // a veces es mejor pasar el texto directamente.
      // Aquí ajustaré handleSendMessage para aceptar argumentos opcionales o 
      // simplemente simulamos el flujo:
      document.querySelector('.send-btn')?.click();
    }, 100);
  };

  // Ajuste para que handleSuggestedQuestion funcione mejor:
  // (Alternativa: Modificar handleSendMessage para aceptar texto opcional)
  /*
  const triggerMessage = (text) => {
      setUserInput(text);
      // ... lógica de envío inmediata ...
  }
  */

  const botRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (event) => {
      // 🆕 CORRECCIÓN: No cerrar el bot si hay una alerta global activa
      // (Para que el usuario no pueda ignorarla accidentalmente)
      if (showGlobalAlert) return;
      
      if (isOpen && botRef.current && !botRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen, showGlobalAlert]); // Agregamos showGlobalAlert como dependencia

  const hasActiveAlert = showGlobalAlert || (criticalAlert && criticalAlert.severity === 'critical');
  const hasItemsInCart = cartOrder.length > 0;

  // 🆕 LÓGICA MODIFICADA DEL RETURN CONDICIONAL
  // ANTES: if (!showAssistantBot && !showGlobalAlert) return null;
  // AHORA: Siempre mostramos el bot si hay una alerta global activa
  if (!showAssistantBot && !showGlobalAlert) {
    return null;
  }

  return (
    <div ref={botRef} className={`lanzo-bot-container ${isOpen ? 'open' : 'closed'} ${hasItemsInCart ? 'has-items' : ''}`}>

      {isOpen && (
        <div className="lanzo-bot-card animate-pop-in">
          <div className="bot-header">
            <span className="bot-title">
              {chatMode ? (
                <>
                  <Sparkles size={16} style={{ marginRight: '6px' }} />
                  Asistente IA
                </>
              ) : (
                showGlobalAlert ? "⚠️ Importante" :
                  criticalAlert ? "Atención Requerida" :
                    (context?.title || 'Lanzo Bot')
              )}
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
              {/* 🆕 CORRECCIÓN: Deshabilitar el botón X si hay alerta global */}
              <button 
                onClick={() => {
                  // Solo permitir cerrar si NO hay alerta global
                  if (!showGlobalAlert) {
                    setIsOpen(false);
                  }
                }} 
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
                      handleDismissAlert(); // Marcamos como visto al hacer clic
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
              // --- MODO CHAT IA (Actualizado) ---
              <div className="chat-container">
                <div className="chat-messages">
                  {messages.length === 0 ? (
                    <div className="chat-welcome">
                      <Sparkles size={32} style={{ color: 'var(--primary-color)' }} />
                      <h4>¡Hola! Soy tu asistente inteligente</h4>
                      <p>Puedo analizar tus ventas, inventario y más. Intenta con:</p>
                      <div className="suggested-questions">
                        <button onClick={() => setUserInput('¿Cuánto he vendido hoy?')}>
                          ¿Cuánto he vendido hoy?
                        </button>
                        <button onClick={() => setUserInput('¿Qué productos tienen stock bajo?')}>
                          ¿Qué productos tienen stock bajo?
                        </button>
                        <button onClick={() => setUserInput('¿Quién me debe dinero?')}>
                          ¿Quién me debe dinero?
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      {messages.map((msg, idx) => (
                        <div key={idx} className={`chat-message ${msg.type}`}>

                          {msg.type === 'bot' && (
                            <div className="message-avatar">
                              <Sparkles size={14} />
                            </div>
                          )}

                          <div className="message-bubble">
                            {/* Soporte para Título */}
                            {msg.title && (
                              <strong style={{ display: 'block', marginBottom: '5px', color: 'var(--primary-color)' }}>
                                {msg.title}
                              </strong>
                            )}

                            {/* Renderiza el mensaje o el texto del usuario */}
                            <p style={{ whiteSpace: 'pre-line', margin: 0 }}>
                              {msg.message || msg.text}
                            </p>

                            {/* Renderizar TIPS si existen */}
                            {msg.tips && msg.tips.length > 0 && (
                              <div className="message-tips" style={{ marginTop: '8px', fontSize: '0.9em', color: '#666', background: 'rgba(0,0,0,0.03)', padding: '8px', borderRadius: '4px' }}>
                                {msg.tips.map((tip, tIdx) => (
                                  <div key={tIdx} style={{ display: 'flex', gap: '4px', marginBottom: '2px' }}>
                                    <Lightbulb size={12} style={{ minWidth: '12px', marginTop: '2px' }} />
                                    <span>{tip}</span>
                                  </div>
                                ))}
                              </div>
                            )}

                            {/* Renderizar ACCIONES (Array) */}
                            {msg.actions && msg.actions.length > 0 && (
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

                            {/* Legacy: Opciones de menú */}
                            {msg.options && (
                              <div className="message-options">
                                {msg.options.map((opt, i) => (
                                  <button
                                    key={i}
                                    className="option-btn"
                                    onClick={() => setUserInput(opt.query)}
                                  >
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
                          <div className="message-avatar">
                            <Sparkles size={14} />
                          </div>
                          <div className="message-bubble typing">
                            <span></span><span></span><span></span>
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
              // --- MODO CONTEXTO (Sin cambios mayores) ---
              <>
                {criticalAlert ? (
                  <div className="critical-alert-card" style={{
                    backgroundColor: criticalAlert.severity === 'critical' ? '#ffebee' : '#fff3e0',
                    padding: '12px',
                    borderRadius: '8px',
                    marginBottom: '12px',
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
                        style={{
                          background: 'white',
                          border: '1px solid #ddd',
                          padding: '4px 12px',
                          borderRadius: '4px',
                          fontSize: '12px',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px',
                          fontWeight: '500'
                        }}
                      >
                        {criticalAlert.action.label} <ExternalLink size={10} />
                      </button>
                    )}
                  </div>
                ) : (
                  <p className="context-message">{context?.message}</p>
                )}

                {quickActions && quickActions.length > 0 && (
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

                {context?.tips && context.tips.length > 0 && (
                  <div className="bot-tips">
                    <small>💡 Tips:</small>
                    <ul>
                      {context.tips.map((tip, idx) => (
                        <li key={idx}>{tip}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* BOTÓN FLOTANTE */}
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

        {!isOpen && (botData.lowStockCount > 0 || botData.licenseDays <= 7 || criticalAlert || showGlobalAlert) && (
          <span className="notification-dot"></span>
        )}
      </button>
    </div>
  );
};

export default AssistantBot;