import { useEffect, useMemo, useRef, useState } from 'react';
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
  subscribeDevConsole,
} from '../../services/devConsoleCapture';
import './DevConsole.css';

const LEVELS = ['all', 'error', 'warn', 'info', 'log', 'debug', 'trace', 'table'];
const FAB_POSITION_STORAGE_KEY = 'lanzo_dev_console_fab_position';
const FAB_LONG_PRESS_MS = 800;
const FAB_DRAG_MARGIN = 8;
const FAB_DRAG_CANCEL_DISTANCE = 8;
const MOBILE_MEDIA_QUERY = '(max-width: 767px), (hover: none) and (pointer: coarse)';

const levelLabel = {
  all: 'Todo',
  error: 'Errores',
  warn: 'Warnings',
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

const countByLevel = (entries, level) => entries.filter((entry) => entry.level === level).length;

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
  window.localStorage.setItem(FAB_POSITION_STORAGE_KEY, JSON.stringify(position));
};

const isMobileViewport = () => (
  typeof window !== 'undefined' &&
  window.matchMedia(MOBILE_MEDIA_QUERY).matches
);

function DevConsole() {
  const [entries, setEntries] = useState(() => getDevConsoleEntries());
  const [isOpen, setIsOpen] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [isMobile, setIsMobile] = useState(isMobileViewport);
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
    if (!isMobile) return undefined;
    if (isPaused) return undefined;
    return subscribeDevConsole(setEntries);
  }, [isMobile, isPaused]);

  useEffect(() => {
    if (!isOpen || isPaused) return;
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [entries, isOpen, isPaused]);

  useEffect(() => {
    const mediaQuery = window.matchMedia(MOBILE_MEDIA_QUERY);
    const handleMediaChange = (event) => {
      setIsMobile(event.matches);
      if (!event.matches) {
        setIsOpen(false);
        setIsFabDragging(false);
        clearLongPressTimer();
        dragStateRef.current = null;
      }
    };

    setIsMobile(mediaQuery.matches);
    mediaQuery.addEventListener('change', handleMediaChange);

    return () => {
      mediaQuery.removeEventListener('change', handleMediaChange);
    };
  }, []);

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
      const matchesQuery = !normalizedQuery || entry.text.toLowerCase().includes(normalizedQuery);
      return matchesLevel && matchesQuery;
    });
  }, [entries, query, selectedLevel]);

  const errorsCount = countByLevel(entries, 'error');
  const warningsCount = countByLevel(entries, 'warn');

  const handleCopy = async () => {
    const text = visibleEntries
      .map((entry) => `[${entry.time}] ${entry.level.toUpperCase()} ${entry.source}: ${entry.text}`)
      .join('\n\n');

    if (!text) return;
    await navigator.clipboard?.writeText(text);
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

  if (!import.meta.env.DEV || !isMobile) return null;

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
        aria-label="Abrir consola de desarrollo"
        title="Toque para abrir. Mantener presionado para mover."
      >
        {errorsCount > 0 ? <AlertTriangle size={18} /> : <Bug size={18} />}
        <span>Consola</span>
        {entries.length > 0 && <strong>{entries.length}</strong>}
      </button>
    );
  }

  return (
    <section className={`dev-console ${isExpanded ? 'dev-console--expanded' : ''}`} aria-label="Consola de desarrollo">
      <header className="dev-console-header">
        <div className="dev-console-title">
          <Bug size={18} />
          <div>
            <strong>Consola DEV</strong>
            <span>{entries.length} eventos | {errorsCount} errores | {warningsCount} warnings</span>
          </div>
        </div>

        <div className="dev-console-actions">
          <button type="button" onClick={() => setIsPaused((value) => !value)} title={isPaused ? 'Reanudar captura visual' : 'Pausar captura visual'}>
            {isPaused ? <Play size={16} /> : <Pause size={16} />}
          </button>
          <button type="button" onClick={handleCopy} title="Copiar logs visibles">
            <Clipboard size={16} />
          </button>
          <button type="button" onClick={clearDevConsoleEntries} title="Limpiar consola">
            <Trash2 size={16} />
          </button>
          <button type="button" onClick={() => setIsExpanded((value) => !value)} title={isExpanded ? 'Reducir panel' : 'Expandir panel'}>
            {isExpanded ? <Minimize2 size={16} /> : <ChevronDown size={16} />}
          </button>
          <button type="button" onClick={() => setIsOpen(false)} title="Cerrar consola">
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

      <div className="dev-console-list" ref={scrollRef}>
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
              <pre>{entry.text}</pre>
            </article>
          ))
        )}
      </div>
    </section>
  );
}

export default DevConsole;
