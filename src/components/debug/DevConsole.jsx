import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  AlertTriangle,
  Bug,
  ChevronDown,
  Clipboard,
  Minimize2,
  Pause,
  Play,
  Trash2,
  X,
} from 'lucide-react';
import {
  clearDevConsoleEntries,
  getDevConsoleEntries,
  formatDevConsoleEntries,
  subscribeDevConsole,
} from '../../services/devConsoleCapture';
import { getDevConsolePreference, subscribeDevConsolePreference, isDevConsoleVisibleNow } from '../../services/devConsolePreferences';
import { copyTextToClipboard } from '../../services/support/supportContact';
import './DevConsole.css';

const LEVELS = ['all', 'error', 'warn', 'info', 'log', 'debug', 'trace', 'table'];
const FAB_POSITION_STORAGE_KEY = 'lanzo_dev_console_fab_position';
const FAB_LONG_PRESS_MS = 800;
const FAB_DRAG_MARGIN = 8;
const FAB_DRAG_CANCEL_DISTANCE = 8;

const levelLabel = {
  all: 'Todo',
  error: 'Errores',
  warn: 'Advertencias',
  info: 'Info',
  log: 'Logs',
  debug: 'Debug',
  trace: 'Trace',
  table: 'Tablas',
};

const levelClassName = {
  error: 'dev-console-entry--error',
  warn: 'dev-console-entry--warn',
  info: 'dev-console-entry--info',
  log: 'dev-console-entry--log',
  debug: 'dev-console-entry--debug',
  trace: 'dev-console-entry--trace',
  table: 'dev-console-entry--table',
};

const countByLevel = (entries, level) => entries.reduce((count, entry) => count + (entry.level === level ? entry.count || 1 : 0), 0);

const readStoredFabPosition = () => {
  if (typeof window === 'undefined') return null;

  try {
    const storedValue = window.localStorage.getItem(FAB_POSITION_STORAGE_KEY);
    if (!storedValue) return null;

    const parsedValue = JSON.parse(storedValue);
    if (!Number.isFinite(parsedValue?.x) || !Number.isFinite(parsedValue?.y)) return null;

    return parsedValue;
  } catch {
    return null;
  }
};

const clampFabPosition = (position, width, height) => {
  if (typeof window === 'undefined') return position;

  const maxX = Math.max(FAB_DRAG_MARGIN, window.innerWidth - width - FAB_DRAG_MARGIN);
  const maxY = Math.max(FAB_DRAG_MARGIN, window.innerHeight - height - FAB_DRAG_MARGIN);

  return {
    x: Math.min(Math.max(FAB_DRAG_MARGIN, position.x), maxX),
    y: Math.min(Math.max(FAB_DRAG_MARGIN, position.y), maxY),
  };
};

const persistFabPosition = (position) => {
  if (typeof window === 'undefined') return;
  try { window.localStorage.setItem(FAB_POSITION_STORAGE_KEY, JSON.stringify(position)); } catch { /* Moving the launcher works without storage. */ }
};

export function DevConsolePanel({ canCopy = isDevConsoleVisibleNow } = {}) {
  const [entries, setEntries] = useState(() => getDevConsoleEntries());
  const [isOpen, setIsOpen] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [copyStatus, setCopyStatus] = useState('');
  const [inspectedId, setInspectedId] = useState(null);
  const followTailRef = useRef(true);
  const wasOpenRef = useRef(false);
  const [selectedLevel, setSelectedLevel] = useState('all');
  const [query, setQuery] = useState('');
  const [fabPosition, setFabPosition] = useState(readStoredFabPosition);
  const [isFabDragging, setIsFabDragging] = useState(false);
  const fabRef = useRef(null);
  const scrollRef = useRef(null);
  const longPressTimerRef = useRef(null);
  const dragStateRef = useRef(null);
  const suppressNextClickRef = useRef(false);

  function clearLongPressTimer() {
    if (!longPressTimerRef.current) return;
    window.clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = null;
  }

  useEffect(() => {
    if (!isOpen && wasOpenRef.current) fabRef.current?.focus();
    wasOpenRef.current = isOpen;
  }, [isOpen]);

  useEffect(() => {
    if (isPaused) return undefined;
    setEntries(getDevConsoleEntries());
    return subscribeDevConsole(setEntries);
  }, [isPaused]);

  useEffect(() => {
    if (!isOpen || isPaused || !followTailRef.current) return;
    scrollRef.current?.scrollTo?.({ top: scrollRef.current.scrollHeight });
  }, [entries, isOpen, isPaused]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const handleEscape = event => { if (event.key === 'Escape') setIsOpen(false); };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [isOpen]);

  useEffect(() => {
    const handleResize = () => {
      setFabPosition((currentPosition) => {
        if (!currentPosition || !fabRef.current) return currentPosition;

        const rect = fabRef.current.getBoundingClientRect();
        const nextPosition = clampFabPosition(currentPosition, rect.width, rect.height);
        persistFabPosition(nextPosition);
        return nextPosition;
      });
    };

    handleResize();
    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('orientationchange', handleResize);
    };
  }, []);

  const visibleEntries = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return entries.filter((entry) => {
      const matchesLevel = selectedLevel === 'all' || entry.level === selectedLevel;
      const matchesQuery = !normalizedQuery
        || `${entry.text} ${entry.evidence || ''} ${entry.severity}`.toLowerCase().includes(normalizedQuery);
      const matchesCategory = selectedCategory === 'all' || entry.category === selectedCategory;
      return matchesLevel && matchesQuery && matchesCategory;
    });
  }, [entries, query, selectedLevel, selectedCategory]);

  const errorsCount = countByLevel(entries, 'error');
  const warningsCount = countByLevel(entries, 'warn');

  const handleCopy = async () => {
    if (!canCopy()) return;
    const text = formatDevConsoleEntries(visibleEntries);
    if (!text) { setCopyStatus('No hay registros para copiar.'); return; }
    try {
      const copied = await copyTextToClipboard(text);
      setCopyStatus(copied ? 'Diagnóstico copiado.' : 'No se pudo copiar. Puedes seleccionar el texto.');
    } catch { setCopyStatus('No se pudo copiar. Puedes seleccionar el texto.'); }
  };

  const handleRefreshWhilePaused = () => {
    setEntries(getDevConsoleEntries());
  };

  useEffect(() => () => clearLongPressTimer(), []);

  const finishFabDrag = (event) => {
    clearLongPressTimer();

    const dragState = dragStateRef.current;
    if (!dragState) return;

    if (dragState.isDragging) {
      if (event.currentTarget.hasPointerCapture?.(dragState.pointerId)) {
        event.currentTarget.releasePointerCapture(dragState.pointerId);
      }
      persistFabPosition(dragState.latestPosition);
    }

    if (dragState.isDragging || dragState.canceledByMovement) {
      suppressNextClickRef.current = true;
      window.setTimeout(() => {
        suppressNextClickRef.current = false;
      }, 120);
    }

    dragStateRef.current = null;
    setIsFabDragging(false);
  };

  const handleFabPointerDown = (event) => {
    if (event.button !== undefined && event.button !== 0) return;

    clearLongPressTimer();

    const button = event.currentTarget;
    const rect = button.getBoundingClientRect();
    const startingPosition = clampFabPosition({ x: rect.left, y: rect.top }, rect.width, rect.height);

    dragStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      width: rect.width,
      height: rect.height,
      isDragging: false,
      canceledByMovement: false,
      latestPosition: startingPosition,
    };

    longPressTimerRef.current = window.setTimeout(() => {
      const dragState = dragStateRef.current;
      if (!dragState) return;

      dragState.isDragging = true;
      button.setPointerCapture?.(dragState.pointerId);
      setFabPosition(dragState.latestPosition);
      setIsFabDragging(true);
    }, FAB_LONG_PRESS_MS);
  };

  const handleFabPointerMove = (event) => {
    const dragState = dragStateRef.current;
    if (!dragState) return;

    const distance = Math.hypot(event.clientX - dragState.startX, event.clientY - dragState.startY);
    if (!dragState.isDragging && distance > FAB_DRAG_CANCEL_DISTANCE) {
      dragState.canceledByMovement = true;
      clearLongPressTimer();
      return;
    }

    if (!dragState.isDragging) return;

    event.preventDefault();

    const nextPosition = clampFabPosition(
      {
        x: event.clientX - dragState.offsetX,
        y: event.clientY - dragState.offsetY,
      },
      dragState.width,
      dragState.height
    );

    dragState.latestPosition = nextPosition;
    setFabPosition(nextPosition);
  };

  const handleFabClick = (event) => {
    if (suppressNextClickRef.current) {
      suppressNextClickRef.current = false;
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    setIsOpen(true);
  };

  if (!isOpen) {
    const fabStyle = fabPosition
      ? {
        left: `${fabPosition.x}px`,
        top: `${fabPosition.y}px`,
        right: 'auto',
        bottom: 'auto',
      }
      : undefined;

    return (
      <button
        ref={fabRef}
        type="button"
        className={`dev-console-fab ${errorsCount > 0 ? 'dev-console-fab--alert' : ''} ${isFabDragging ? 'dev-console-fab--dragging' : ''}`}
        style={fabStyle}
        onClick={handleFabClick}
        onPointerDown={handleFabPointerDown}
        onPointerMove={handleFabPointerMove}
        onPointerUp={finishFabDrag}
        onPointerCancel={finishFabDrag}
        onContextMenu={(event) => event.preventDefault()}
        aria-label="Abrir consola de diagnóstico" aria-expanded="false"
        title="Toque para abrir. Mantener presionado para mover."
      >
        {errorsCount > 0 ? <AlertTriangle size={18} /> : <Bug size={18} />}
        <span>Consola</span>
        {entries.length > 0 && <strong>{entries.length}</strong>}
      </button>
    );
  }

  return (
    <section className={`dev-console ${isExpanded ? 'dev-console--expanded' : ''}`} aria-label="Consola de diagnóstico">
      <header className="dev-console-header">
        <div className="dev-console-title">
          <Bug size={18} />
          <div>
            <strong>Diagnóstico LANZO POS</strong>
            <span>{entries.length} registros | {errorsCount} errores | {warningsCount} advertencias</span>
          </div>
        </div>

        <div className="dev-console-actions">
          <button type="button" onClick={() => setIsPaused((value) => !value)} aria-pressed={isPaused} title={isPaused ? 'Reanudar captura visual' : 'Pausar captura visual'}>
            {isPaused ? <Play size={16} /> : <Pause size={16} />}
          </button>
          <button type="button" onClick={handleCopy} title="Copiar logs visibles">
            <Clipboard size={16} />
          </button>
          <button type="button" onClick={() => { clearDevConsoleEntries(); setEntries([]); }} title="Limpiar consola">
            <Trash2 size={16} />
          </button>
          <button type="button" onClick={() => setIsExpanded((value) => !value)} title={isExpanded ? 'Reducir panel' : 'Expandir panel'}>
            {isExpanded ? <Minimize2 size={16} /> : <ChevronDown size={16} />}
          </button>
          <button type="button" autoFocus onClick={() => setIsOpen(false)} title="Cerrar consola">
            <X size={16} />
          </button>
        </div>
      </header>

      <div className="dev-console-toolbar">
        <select value={selectedLevel} onChange={(event) => setSelectedLevel(event.target.value)} aria-label="Filtrar por nivel">
          {LEVELS.map((level) => (
            <option key={level} value={level}>{levelLabel[level]}</option>
          ))}
        </select>
        <select value={selectedCategory} onChange={event => setSelectedCategory(event.target.value)} aria-label="Filtrar por categoría">
          <option value="all">Todas las categorías</option>
          <option value="unclassified">Eventos sin clasificar</option>
          <option value="unknown">Errores sin contexto</option>
          <option value="indexeddb">Almacenamiento local</option>
          <option value="synchronization">Sincronización</option>
          <option value="supabase_rpc">Servicio remoto</option>
          <option value="authorization_session">Sesión</option>
          <option value="financial_operation">Operación financiera</option>
          <option value="connectivity">Conectividad</option>
          <option value="navigation_resource">Recursos</option>
          <option value="pwa">Aplicación instalada</option>
        </select>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Buscar en logs"
          aria-label="Buscar en logs"
        />
        {isPaused && (
          <button type="button" className="dev-console-refresh" onClick={handleRefreshWhilePaused}>
            Actualizar
          </button>
        )}
      </div>

      <div className="dev-console-status" role="status">
        {copyStatus || (isPaused ? 'Vista pausada; la captura y los avisos operativos continúan.' : 'Hasta 300 registros locales. Los mensajes originales son solo para inspección; la copia sigue restringida.')}
      </div>
      <div className="dev-console-list" ref={scrollRef} onScroll={event => {
        const list = event.currentTarget;
        followTailRef.current = list.scrollHeight - list.scrollTop - list.clientHeight < 60;
      }}>
        {visibleEntries.length === 0 ? (
          <div className="dev-console-empty">
            No hay registros para este filtro.
          </div>
        ) : (
          visibleEntries.map((entry) => (
            <article key={entry.id} className={`dev-console-entry ${levelClassName[entry.level] || ''}`}>
              <div className="dev-console-entry-meta">
                <span>{entry.time}</span>
                <strong>{entry.level}</strong>
                <em>{entry.source}</em>
              </div>
              {entry.count > 1 && <span className="dev-console-repeat">{entry.count} eventos equivalentes · {entry.firstTimestamp} → {entry.timestamp}</span>}
              <pre>{entry.text}</pre>
              {entry.evidence && <pre>Dato técnico: {entry.evidence}</pre>}
              {entry.level === 'error' || entry.errorType ? <span className="dev-console-impact">
                Impacto: {entry.severity === 'critical_blocker' ? 'Bloqueante; verificar resultado antes de reintentar'
                  : entry.severity === 'recoverable' ? 'Recuperable' : 'No determinado; requiere revisión'}
              </span> : null}
              <button className="dev-console-inspect" type="button" aria-expanded={inspectedId === entry.id}
                onClick={() => setInspectedId(current => current === entry.id ? null : entry.id)}>Examinar registro</button>
              {inspectedId === entry.id && (
                <div className="dev-console-inspection">
                  <pre>{formatDevConsoleEntries([entry])}</pre>
                  {entry.technical && (
                    <div className="dev-console-original">
                      <div><strong>Tipo original:</strong> {entry.technical.name}</div>
                      {entry.technical.code && <div><strong>Código original:</strong> {entry.technical.code}</div>}
                      {entry.technical.status !== null && <div><strong>HTTP:</strong> {entry.technical.status}</div>}
                      {entry.technical.message && <pre>Mensaje original: {entry.technical.message}</pre>}
                      {entry.technical.details && <pre>Detalles: {entry.technical.details}</pre>}
                      {entry.technical.hint && <pre>Hint: {entry.technical.hint}</pre>}
                      {entry.technical.stack && <pre style={{ whiteSpace: 'pre', overflowWrap: 'normal', overflowX: 'auto', maxWidth: '100%', maxHeight: '32dvh', overflowY: 'auto' }}>Stack original: {'\n'}{entry.technical.stack}</pre>}
                      {entry.technical.filename && <pre>Archivo: {entry.technical.filename}</pre>}
                      {entry.technical.line !== null && <div><strong>Línea:</strong> {entry.technical.line}</div>}
                      {entry.technical.column !== null && <div><strong>Columna:</strong> {entry.technical.column}</div>}
                      {entry.technical.resourceError && <div>Evento de carga de recurso; el navegador no proporcionó una excepción JavaScript.</div>}
                    </div>
                  )}
                </div>
              )}
            </article>
          ))
        )}
      </div>
    </section>
  );
}

export default function DevConsole({ isSuppressed = false } = {}) {
  const preference = useSyncExternalStore(subscribeDevConsolePreference, getDevConsolePreference, getDevConsolePreference);
  if (isSuppressed || !preference.enabled) return null;
  return <DevConsolePanel key={preference.revision} />;
}
