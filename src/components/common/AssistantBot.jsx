import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { X, Send, Sparkles, Lightbulb, ArrowUpRight, LayoutGrid, MessageCircle } from 'lucide-react';
import { GLOBAL_ALERT, acknowledgeGlobalAlert } from '../../config/botContext';
import { BOT_RUBROS } from '../../config/botContextByRubro';
import { normalizeBusinessTypes } from '../../utils/businessType';
import { canOpenBotAction } from '../../utils/botNavigation';
import { useAppStore } from '../../store/useAppStore';
import { useActorRuntimeSnapshot } from '../../services/auth/useActorRuntimeSnapshot';
import { useSettingsAccess } from '../../services/auth/useSettingsAccess';
import { isCloudPosSyncEnabled } from '../../services/sync/syncConstants';
import { useBotAssistant } from '../../hooks/useBotAssistant';
import { useBotScreenContext } from '../../hooks/useBotScreenContext';
import { useActiveOrders } from '../../hooks/pos/useActiveOrders';
import './AssistantBot.css';

const AssistantBot = ({ enabled = true, globalAlertEligible = false, isSuppressed = false }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const actor = useActorRuntimeSnapshot();
  const settingsAccess = useSettingsAccess();
  const hasItems = useActiveOrders(state => Boolean(state.activeOrders.get(state.currentOrderId)?.items?.length));
  const profile = useAppStore(state => state.companyProfile);
  const license = useAppStore(state => state.licenseDetails);
  const canAccess = useAppStore(state => state.canAccess);
  const publishedScreen = useBotScreenContext();
  const localTab = publishedScreen?.pathname === location.pathname ? publishedScreen.tab : '';
  const businessType = normalizeBusinessTypes(profile?.business_type, 'abarrotes')[0];
  const businessLabel = BOT_RUBROS[businessType]?.label || 'Negocio';
  const cloud = isCloudPosSyncEnabled(license);
  const [online, setOnline] = useState(() => navigator.onLine !== false);
  const [open, setOpen] = useState(false);
  const [showResources, setShowResources] = useState(false);
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const contextKey = `${location.pathname}${location.search}:${localTab}:${actor.generation}:${actor.tenant?.generation}:${actor.tenant?.opaqueId}:${enabled}`;
  const showAlert = globalAlertEligible && !dismissed;
  const motorEnabled = enabled && open && !showAlert && !isSuppressed;
  const { askBot, screen, error: workerError } = useBotAssistant(contextKey, motorEnabled, { pathname: location.pathname, search: location.search, tab: localTab, businessType, actorType: actor.actorType, cloud, online });
  const currentKey = useRef(contextKey);
  currentKey.current = contextKey;
  const pending = useRef(null);
  const sequence = useRef(0);
  const lastSubmission = useRef(null);
  const historyRef = useRef(null);
  const containerRef = useRef(null);
  const launcherRef = useRef(null);
  const panelRef = useRef(null);
  const panelOpen = open || showAlert;

  useEffect(() => {
    if (!motorEnabled) return;
    const update = () => setOnline(navigator.onLine !== false);
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update); };
  }, [motorEnabled]);
  useEffect(() => {
    pending.current = null;
    lastSubmission.current = null;
    setMessages([]);
    setInput('');
    setBusy(false);
    setShowResources(false);
  }, [contextKey, motorEnabled]);
  useEffect(() => () => { pending.current = null; }, []);
  useEffect(() => {
    const history = historyRef.current;
    if (history && !showResources) history.scrollTop = history.scrollHeight;
  }, [messages, busy, showResources]);
  useEffect(() => {
    // Focus the panel without summoning the phone keyboard automatically.
    if (panelOpen) panelRef.current?.focus();
  }, [panelOpen]);

  useEffect(() => {
    if (!panelOpen || !window.visualViewport) return;
    const updateViewport = () => {
      const viewport = window.visualViewport;
      const inset = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
      containerRef.current?.style.setProperty('--bot-viewport-height', `${viewport.height}px`);
      containerRef.current?.style.setProperty('--bot-keyboard-inset', `${inset}px`);
      setKeyboardOpen(inset > 120);
    };
    updateViewport();
    window.visualViewport.addEventListener('resize', updateViewport);
    window.visualViewport.addEventListener('scroll', updateViewport);
    return () => {
      window.visualViewport.removeEventListener('resize', updateViewport);
      window.visualViewport.removeEventListener('scroll', updateViewport);
    };
  }, [panelOpen]);

  const close = () => {
    if (showAlert) {
      if (GLOBAL_ALERT.isDismissible === false || GLOBAL_ALERT.severity === 'critical') return;
      acknowledgeGlobalAlert(GLOBAL_ALERT);
      setDismissed(true);
    }
    pending.current = null;
    setOpen(false);
    requestAnimationFrame(() => launcherRef.current?.focus());
  };
  const send = useCallback(async (raw, { retry = false } = {}) => {
    const text = (raw ?? input).trim();
    if (!text || pending.current) return;
    const last = lastSubmission.current;
    if (!retry && last?.key === contextKey && last.text === text && Date.now() - last.at < 500) return;
    lastSubmission.current = { key: contextKey, text, at: Date.now() };
    const request = { key: contextKey };
    pending.current = request;
    const isCurrent = () => pending.current === request && currentKey.current === request.key;
    const add = (message) => setMessages(previous => [...previous.slice(-39), { ...message, id: ++sequence.current }]);
    add({ type: 'user', message: text });
    setInput('');
    setBusy(true);
    setShowResources(false);
    try {
      const response = await askBot(text, { pathname: location.pathname, search: location.search, tab: localTab, businessType, actorType: actor.actorType, cloud, online });
      if (isCurrent()) add({ type: 'bot', ...response, retry: response.retryable ? text : undefined });
    } catch (error) {
      if (!isCurrent() || error.code === 'BOT_CANCELLED') return;
      add({ type: 'bot', title: 'No pude completar la pregunta', message: error.code === 'BOT_TIMEOUT'
        ? 'La consulta tardó demasiado. Puedes reintentar o continuar con otra pregunta.'
        : 'No pude iniciar o procesar la pregunta en el motor independiente. Reintenta; si tu navegador bloquea Workers, revisa su configuración.', retry: text });
    } finally {
      if (isCurrent()) { pending.current = null; setBusy(false); }
    }
  }, [input, contextKey, askBot, location.pathname, location.search, localTab, businessType, actor.actorType, cloud, online]);
  const actionAllowed = path => canOpenBotAction(path, canAccess, {
    licenseDetails: license,
    actorSnapshot: actor,
    settingsAccess
  });
  const navigateAction = (action) => {
    if (!actionAllowed(action.path)) return;
    setOpen(false);
    navigate(action.path);
  };
  if (isSuppressed || (!enabled && !showAlert)) return null;
  const suggestions = screen.guides.slice(0, 3);
  const quickActions = [...new Map((screen.actions || [])
    .filter(action => actionAllowed(action.path) && action.path !== location.pathname + location.search)
    .map(action => [action.path, action])).values()].slice(0, 4);
  return (
    <div ref={containerRef} className={`lanzo-bot-container ${panelOpen ? 'open' : 'closed'} ${hasItems && location.pathname === '/' ? 'has-items' : ''} ${keyboardOpen && panelOpen ? 'keyboard-open' : ''} ${showAlert ? 'alert-active' : ''}`}>
      {panelOpen && (
        <section id="lanzo-bot-panel" ref={panelRef} tabIndex={-1} className="lanzo-bot-card" role="region" aria-label="Lanzó Bot" onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); close(); } }}>
          <div className="bot-header">
            <div className="bot-heading">
              {showAlert ? (
                <h2 className="bot-title"><Sparkles size={17} aria-hidden="true" />{GLOBAL_ALERT.title}</h2>
              ) : (
                <div className="bot-heading-line">
                  <h2 className="bot-title"><Sparkles size={17} aria-hidden="true" />Lanzó Bot</h2>
                  <span className="bot-heading-separator" aria-hidden="true">·</span>
                  <span className="bot-subtitle" title={screen.label}>{screen.label}</span>
                </div>
              )}
            </div>
            {(showAlert || keyboardOpen) && (
              <button type="button" className="close-btn" onClick={close} aria-label="Cerrar asistente" disabled={showAlert && (GLOBAL_ALERT.isDismissible === false || GLOBAL_ALERT.severity === 'critical')}><X size={20} aria-hidden="true" /></button>
            )}
          </div>
          <div className="bot-body">
            {showAlert ? <div className="alert-content">
              <p className="alert-text">{GLOBAL_ALERT.message}</p>
              <button type="button" className="action-btn" onClick={() => { acknowledgeGlobalAlert(GLOBAL_ALERT); setDismissed(true); setOpen(false); }}>Entendido</button>
              {actionAllowed(GLOBAL_ALERT.actionLink) && <button type="button" className="action-btn action-btn--secondary" onClick={() => { acknowledgeGlobalAlert(GLOBAL_ALERT); setDismissed(true); navigateAction({ path: GLOBAL_ALERT.actionLink }); }}>{GLOBAL_ALERT.actionLabel}</button>}
            </div> : <>
              <p className="chat-context-note">{businessLabel} · {cloud ? 'Nube' : 'Free / Local'} · {online ? 'Con conexión' : 'Sin conexión'}</p>
              <div className="chat-container">
                {workerError && <p className="bot-warning" role="status">{workerError}</p>}
                {(messages.length === 0 || showResources) ? (
                  <div className="bot-resources" aria-label="Ayuda de la pantalla">
                    <section className="bot-context-block">
                      <h3><Sparkles size={15} aria-hidden="true" /> ¿Qué puedes hacer aquí?</h3>
                      <p>{screen.description || 'Preparando la ayuda de esta pantalla…'}</p>
                    </section>
                    {quickActions.length > 0 && <section className="bot-resource-group" aria-label="Accesos rápidos">
                      <h3><LayoutGrid size={15} aria-hidden="true" /> Accesos rápidos</h3>
                      <div className="bot-quick-actions">
                        {quickActions.map(action => (
                          <button type="button" key={action.path} onClick={() => navigateAction(action)} aria-label={'Ir a ' + action.label}>
                            <span>{action.label}</span><ArrowUpRight size={15} aria-hidden="true" />
                          </button>
                        ))}
                      </div>
                    </section>}
                    {suggestions.length > 0 && <section className="bot-resource-group" aria-label="Preguntas sugeridas">
                      <h3><Lightbulb size={15} aria-hidden="true" /> Preguntas sugeridas</h3>
                      <div className="suggested-questions">{suggestions.map(guide => <button key={guide.id} type="button" disabled={busy} onClick={() => send(guide.question)}>{guide.question}</button>)}</div>
                    </section>}
                  </div>
                ) : (
                  <div ref={historyRef} className="chat-messages" role="log" aria-label="Conversación con Lanzó Bot" aria-live="polite" aria-relevant="additions" aria-busy={busy}>
                    {messages.map(message => {
                      const actions = (message.actions || []).filter(action => actionAllowed(action.path));
                      return <div key={message.id} className={'chat-message ' + message.type}><div className="message-bubble">
                        {message.title && <strong className="bot-response-title">{message.title}</strong>}
                        <p className="bot-response-text">{message.message}</p>
                        {message.tips?.length > 0 && <ul className="message-tips">{message.tips.map(tip => <li key={tip}>{tip}</li>)}</ul>}
                        {actions.map(action => <button type="button" key={action.path} className="inline-action-btn" onClick={() => navigateAction(action)}>{action.label}</button>)}
                        {message.actions?.length > 0 && actions.length === 0 && <p className="chat-context-note">El atajo no está disponible para los permisos o las funciones de tu sesión. Puedes consultar los pasos con un administrador.</p>}
                        {message.options?.map(option => <button type="button" key={option.query} className="option-btn" disabled={busy} onClick={() => send(option.query)}>{option.label}</button>)}
                        {message.retry && <button type="button" className="inline-action-btn" disabled={busy} onClick={() => send(message.retry, { retry: true })}>Reintentar pregunta</button>}
                      </div></div>;
                    })}
                  </div>
                )}
                {busy && <p role="status" className="bot-processing">Procesando pregunta…</p>}
                {messages.length > 0 && <button type="button" className="bot-switch-view" onClick={() => setShowResources(value => !value)} aria-pressed={showResources}>
                  <MessageCircle size={15} aria-hidden="true" />{showResources ? 'Volver a la conversación' : 'Ver accesos y preguntas'}
                </button>}
                <form className="chat-input-wrapper" onSubmit={event => { event.preventDefault(); send(); }}>
                  <input className="chat-input" aria-label="Pregunta para el asistente" placeholder="Escribe tu pregunta…" value={input} maxLength={500} onChange={event => setInput(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && event.nativeEvent.isComposing) event.preventDefault(); }} />
                  <button type="submit" className="send-btn" aria-label="Enviar pregunta" disabled={busy || !input.trim()}><Send size={18} /></button>
                </form>
              </div>
            </>}
          </div>
        </section>
      )}
      {!showAlert && <button ref={launcherRef} type="button" className="lanzo-bot-fab" title={open ? 'Cerrar asistente' : 'Abrir asistente'} aria-label={open ? 'Cerrar Lanzó Bot' : 'Abrir Lanzó Bot'} aria-controls={panelOpen ? 'lanzo-bot-panel' : undefined} aria-expanded={panelOpen} onClick={() => open ? close() : setOpen(true)}>{open ? <X size={22} aria-hidden="true" /> : <img src="/boticon.svg" alt="" width="28" height="28" />}</button>}
    </div>
  );
};
export default AssistantBot;
