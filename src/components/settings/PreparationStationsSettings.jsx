import { useEffect, useId, useRef, useState } from 'react';
import { Check, LoaderCircle, Pencil, Plus, RefreshCw } from 'lucide-react';
import { Link } from 'react-router-dom';
import { usePreparationStations } from '../../hooks/restaurant/usePreparationStations';
import { useAppStore } from '../../store/useAppStore';
import { useSettingsAccess } from '../../services/auth/useSettingsAccess';
import { FALLBACK_PREPARATION_STATIONS } from '../../services/restaurant/preparationStationsRepository';
import { canShowLocalPlanDiscovery } from './localPlanDiscovery';
import './PreparationStationsSettings.css';

const isActive = (station) => station.isActive !== false;

function requireSuccess(response, fallbackMessage, conflictMessage) {
  if (response?.success === true) return;
  if (response?.code === 'VERSION_CONFLICT') {
    throw Object.assign(new Error(conflictMessage), { code: response.code });
  }
  throw new Error(response?.message || fallbackMessage);
}

function StationRow({ station, canManage, busy, toggling, onEdit, onToggle }) {
  const isDefault = station.isDefault || station.code === 'kitchen';
  const active = isActive(station);

  return (
    <li className="preparation-station-row">
      <div className="preparation-station-main">
        <strong>{station.name}</strong>
        <span className="preparation-stations-meta">
          {isDefault ? 'Predeterminada · Siempre activa' : active ? 'Activa' : 'Inactiva'}
        </span>
      </div>
      <div className="preparation-station-actions">
        {isDefault && <Check size={19} className="preparation-station-default" aria-hidden="true" />}
        {canManage && !isDefault && (
          <button
            type="button"
            role="switch"
            className="preparation-station-switch"
            aria-label={`Activación de ${station.name}`}
            aria-checked={active}
            aria-busy={toggling}
            aria-disabled={busy}
            onClick={() => onToggle(station, !active)}
          >
            {toggling
              ? <LoaderCircle size={18} className="icon-spin" aria-hidden="true" />
              : <span className="preparation-station-switch-track" aria-hidden="true" />}
          </button>
        )}
        {canManage && (
          <button
            type="button"
            className="ui-button ui-button--ghost preparation-stations-icon"
            aria-label={`Editar ${station.name}`}
            aria-haspopup="dialog"
            aria-disabled={busy}
            onClick={(event) => onEdit(event.currentTarget, station)}
          >
            <Pencil size={17} aria-hidden="true" />
          </button>
        )}
      </div>
    </li>
  );
}

function StationEditor({ editor, currentStation, refreshNeeded, busy, onSave, onClose, fallbackFocus }) {
  const [original, setOriginal] = useState(editor.station);
  const [name, setName] = useState(original?.name || '');
  const [error, setError] = useState('');
  const [hasConflict, setHasConflict] = useState(false);
  const dialogRef = useRef(null);
  const inputRef = useRef(null);
  const id = useId();
  const trimmedName = name.trim();
  const canSubmit = !busy && !hasConflict && trimmedName && trimmedName !== original?.name;

  useEffect(() => {
    const dialog = dialogRef.current;
    const fallback = fallbackFocus.current;
    const viewport = window.visualViewport;

    // Native dialogs are centered in the layout viewport, which can place them
    // above the visible screen when Android opens the software keyboard.
    const positionInVisibleViewport = () => {
      if (!viewport) return;
      const visibleHeight = Math.max(0, viewport.height);
      dialog.style.setProperty(
        '--preparation-dialog-center-y',
        `${Math.round(viewport.offsetTop + visibleHeight / 2)}px`
      );
      dialog.style.setProperty(
        '--preparation-dialog-visible-height',
        `${Math.max(0, Math.floor(visibleHeight - 24))}px`
      );
    };

    dialog.showModal();
    positionInVisibleViewport();
    viewport?.addEventListener('resize', positionInVisibleViewport);
    viewport?.addEventListener('scroll', positionInVisibleViewport);
    inputRef.current.focus({ preventScroll: true });

    return () => {
      viewport?.removeEventListener('resize', positionInVisibleViewport);
      viewport?.removeEventListener('scroll', positionInVisibleViewport);
      dialog.close();
      if (editor.trigger.isConnected) editor.trigger.focus();
      else fallback?.focus();
    };
  }, [editor, fallbackFocus]);

  const submit = async (event) => {
    event.preventDefault();
    if (!canSubmit) return;
    setError('');
    try {
      await onSave(original, trimmedName);
    } catch (saveError) {
      setError(saveError?.message || 'No se pudo guardar el área.');
      setHasConflict(saveError?.code === 'VERSION_CONFLICT');
    }
  };

  return (
    <dialog
      ref={dialogRef}
      className="preparation-station-dialog"
      aria-labelledby={`${id}-title`}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <form onSubmit={submit} aria-busy={busy}>
        <h3 id={`${id}-title`}>{original ? 'Editar área' : 'Nueva área de preparación'}</h3>
        <label className="form-label" htmlFor={`${id}-name`}>Nombre del área</label>
        <input
          ref={inputRef}
          id={`${id}-name`}
          className="form-input"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder={original ? undefined : 'Ej. Barra, Bebidas o Postres'}
          required
          readOnly={busy}
          aria-describedby={error ? `${id}-error` : undefined}
        />
        {error && <p id={`${id}-error`} className="ui-inline-error" role="alert">{error}</p>}
        {hasConflict && (
          refreshNeeded || !currentStation || currentStation.serverVersion === original.serverVersion ? (
            <p className="preparation-stations-meta">Cancela y actualiza el listado para volver a editar.</p>
          ) : (
            <div className="preparation-station-conflict">
              <p className="preparation-stations-meta">Nombre vigente: <strong>{currentStation.name}</strong></p>
              <button type="button" className="ui-button ui-button--secondary" onClick={() => {
                setOriginal(currentStation);
                setHasConflict(false);
                setError('');
                inputRef.current.focus();
              }}>
                Usar versión actual
              </button>
            </div>
          )
        )}
        <div className="preparation-station-dialog-actions">
          <button type="button" className="ui-button ui-button--ghost" aria-disabled={busy} onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="ui-button ui-button--primary" disabled={!canSubmit}>
            {busy ? 'Guardando…' : original ? 'Guardar cambios' : 'Crear área'}
          </button>
        </div>
      </form>
    </dialog>
  );
}

function PreparationStationsPanel({ canDiscover }) {
  const [editor, setEditor] = useState(null);
  const [operation, setOperation] = useState(null);
  const [feedback, setFeedback] = useState(null);
  const pending = useRef(false);
  const heading = useRef(null);
  const titleId = useId();
  const {
    stations, isLoading, error, source, canManageStations, isDynamicStationsEnabled,
    refreshStations, createStation, updateStation, toggleStation
  } = usePreparationStations({ includeInactive: true });

  if (editor && !canManageStations) setEditor(null);

  const busy = isLoading || Boolean(operation);
  const listedStations = isDynamicStationsEnabled ? stations : FALLBACK_PREPARATION_STATIONS;
  const activeCount = listedStations.filter(isActive).length;
  const count = `${listedStations.length} ${listedStations.length === 1 ? 'área' : 'áreas'} · ${activeCount} ${activeCount === 1 ? 'activa' : 'activas'}`;
  let summary = count;
  if (source === 'cache') summary = `${count} · Copia local`;
  else if (source === 'fallback') summary = isLoading ? 'Cargando áreas…' : 'Mostrando el área predeterminada';
  else if (error) summary = `${count} · Actualización sin confirmar`;
  const currentStation = editor?.station && stations.find((station) => station.id === editor.station.id);

  const openEditor = (trigger, station = null) => {
    if (!canManageStations || busy || pending.current) return;
    setFeedback(null);
    setEditor({ trigger, station });
  };

  const runOperation = async (key, action, fallbackMessage) => {
    if (busy || pending.current) return;
    pending.current = true;
    setOperation(key);
    setFeedback(null);
    try {
      await action();
    } catch (operationError) {
      if (key === 'save') throw operationError;
      setFeedback({ error: true, message: operationError?.message || fallbackMessage });
    } finally {
      pending.current = false;
      setOperation(null);
    }
  };

  const save = (station, name) => {
    if (!canManageStations) return;
    return runOperation('save', async () => {
      const response = station ? await updateStation(station, { name }) : await createStation({ name });
      requireSuccess(
        response,
        station ? 'No se pudo actualizar el área.' : 'No se pudo crear el área.',
        'El área cambió en otro dispositivo. Revisa el nombre vigente antes de guardar.'
      );
      setEditor(null);
      setFeedback({ message: station ? 'Área actualizada.' : 'Área creada.' });
    });
  };

  const toggle = (station, nextActive) => {
    if (!canManageStations || station.isDefault || station.code === 'kitchen') return;
    const failure = 'No se pudo cambiar el estado del área.';
    return runOperation(station.id, async () => {
      const response = await toggleStation(station, nextActive);
      requireSuccess(response, failure, 'El área cambió en otro dispositivo. Revisa su estado actualizado.');
      setFeedback({ message: nextActive ? 'Área activada.' : 'Área desactivada.' });
    }, failure);
  };

  return (
    <section className="preparation-stations-settings" aria-labelledby={titleId}>
      <header className="preparation-stations-header">
        <div>
          <h2 id={titleId} ref={heading} tabIndex={-1}>Áreas de preparación</h2>
          <p className="preparation-stations-meta">Organiza el destino de tus comandas.</p>
        </div>
        {isDynamicStationsEnabled && (
          <button
            type="button"
            className="ui-button ui-button--ghost preparation-stations-icon"
            aria-label="Actualizar áreas de preparación"
            aria-disabled={busy}
            aria-busy={isLoading || operation === 'refresh'}
            onClick={() => runOperation('refresh', () => refreshStations({ force: true }), 'No se pudieron actualizar las áreas.')}
          >
            <RefreshCw size={18} className={isLoading || operation === 'refresh' ? 'icon-spin' : ''} aria-hidden="true" />
          </button>
        )}
      </header>

      {isDynamicStationsEnabled && (
        <>
          <div className="preparation-stations-toolbar">
            <p className="preparation-stations-meta" role="status">{summary}</p>
            {canManageStations && (
              <button
                type="button"
                className="ui-button ui-button--primary preparation-stations-add"
                aria-haspopup="dialog"
                aria-disabled={busy}
                onClick={(event) => openEditor(event.currentTarget)}
              >
                <Plus size={17} aria-hidden="true" /> Nueva área
              </button>
            )}
          </div>
          {!canManageStations && <p className="preparation-stations-meta">Solo lectura. Tu usuario no puede modificar áreas.</p>}
          {error && <p className="ui-inline-error" role="alert">{error}</p>}
          {feedback && (
            <p className={feedback.error ? 'ui-inline-error' : 'preparation-stations-meta'} role={feedback.error ? 'alert' : 'status'}>
              {feedback.message}
            </p>
          )}
        </>
      )}

      <ul className="preparation-station-list" aria-label="Áreas de preparación">
        {listedStations.map((station) => (
          <StationRow
            key={station.id}
            station={station}
            canManage={canManageStations}
            busy={busy}
            toggling={operation === station.id}
            onEdit={openEditor}
            onToggle={toggle}
          />
        ))}
      </ul>

      {!isDynamicStationsEnabled && canDiscover && (
        <div className="preparation-stations-discovery">
          <h3>Más áreas con Lanzo Nube</h3>
          <p className="preparation-stations-meta">Administra áreas como Barra o Postres y dirige las comandas según el producto.</p>
          <Link className="ui-button ui-button--secondary" to="/acerca-de">Conocer Lanzo Nube</Link>
        </div>
      )}

      {editor && canManageStations && (
        <StationEditor
          editor={editor}
          currentStation={currentStation}
          refreshNeeded={Boolean(error) || source !== 'cloud'}
          busy={operation === 'save'}
          onSave={save}
          onClose={() => {
            if (!pending.current) setEditor(null);
          }}
          fallbackFocus={heading}
        />
      )}
    </section>
  );
}

export default function PreparationStationsSettings() {
  const licenseDetails = useAppStore((state) => state.licenseDetails);
  const settingsAccess = useSettingsAccess();
  return (
    <PreparationStationsPanel
      key={`${settingsAccess.actorKey}:${settingsAccess.generation}`}
      canDiscover={canShowLocalPlanDiscovery(licenseDetails, settingsAccess, 'license')}
    />
  );
}
