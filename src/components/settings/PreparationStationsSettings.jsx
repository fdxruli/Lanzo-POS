import { useState } from 'react';
import { Info, Plus, RefreshCcw } from 'lucide-react';
import { usePreparationStations } from '../../hooks/restaurant/usePreparationStations';
import { showMessageModal } from '../../services/utils';

function StationRow({ station, canManageStations, onRename, onToggle }) {
  const [draftName, setDraftName] = useState(station.name || '');
  const [isSaving, setIsSaving] = useState(false);
  const isDefault = station.isDefault || station.code === 'kitchen';
  const hasChanges = draftName.trim() && draftName.trim() !== station.name;

  const handleRename = async () => {
    if (!hasChanges) return;
    setIsSaving(true);
    try {
      const response = await onRename(station, draftName.trim());
      if (response?.success === false) {
        showMessageModal(response.message || 'No se pudo actualizar el area.', null, { type: 'error' });
        return;
      }
      showMessageModal('Area actualizada correctamente.');
    } catch (error) {
      showMessageModal(error?.message || 'No se pudo actualizar el area.', null, { type: 'error' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggle = async (event) => {
    const nextValue = event.target.checked;
    setIsSaving(true);
    try {
      const response = await onToggle(station, nextValue);
      if (response?.success === false) {
        showMessageModal(response.message || 'No se pudo cambiar el estado del area.', null, { type: 'error' });
        return;
      }
      showMessageModal(nextValue ? 'Area activada.' : 'Area desactivada.');
    } catch (error) {
      showMessageModal(error?.message || 'No se pudo cambiar el estado del area.', null, { type: 'error' });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className={`preparation-station-row ${station.isActive === false ? 'is-inactive' : ''}`}>
      <div className="preparation-station-main">
        <div className="preparation-station-title-row">
          <strong>{station.name}</strong>
          {isDefault && <span className="preparation-station-badge preparation-station-badge--default">Predeterminada</span>}
          {station.isActive === false && <span className="preparation-station-badge">Inactiva</span>}
        </div>
        <span className="settings-option-meta">Codigo interno: {station.code}</span>
      </div>

      <div className="preparation-station-actions">
        <input
          className="form-input preparation-station-name-input"
          value={draftName}
          onChange={(event) => setDraftName(event.target.value)}
          disabled={!canManageStations || isSaving}
          aria-label={`Nombre de ${station.name}`}
        />
        <button
          type="button"
          className="btn btn-secondary preparation-station-save-button"
          onClick={handleRename}
          disabled={!canManageStations || !hasChanges || isSaving}
        >
          Guardar
        </button>

        <label className={`settings-switch ${(!canManageStations || isDefault || isSaving) ? 'is-disabled' : ''}`} title={isDefault ? 'Cocina siempre permanece activa' : ''}>
          <input
            className="settings-switch__input"
            type="checkbox"
            checked={station.isActive !== false}
            onChange={handleToggle}
            disabled={!canManageStations || isDefault || isSaving}
          />
          <span className={`settings-switch__track ${station.isActive !== false ? 'is-on' : ''} ${(!canManageStations || isDefault || isSaving) ? 'is-disabled' : ''}`}></span>
          <span className={`settings-switch__thumb ${station.isActive !== false ? 'is-on' : ''}`}></span>
        </label>
      </div>
    </div>
  );
}

export default function PreparationStationsSettings() {
  const [newStationName, setNewStationName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const {
    stations,
    isLoading,
    error,
    canManageStations,
    isDynamicStationsEnabled,
    refreshStations,
    createStation,
    updateStation,
    toggleStation
  } = usePreparationStations({ includeInactive: true });

  const handleCreate = async () => {
    const name = newStationName.trim();
    if (!name) return;

    setIsCreating(true);
    try {
      const response = await createStation({ name });
      if (response?.success === false) {
        showMessageModal(response.message || 'No se pudo crear el area.', null, { type: 'error' });
        return;
      }
      setNewStationName('');
      showMessageModal('Area creada correctamente.');
    } catch (createError) {
      showMessageModal(createError?.message || 'No se pudo crear el area.', null, { type: 'error' });
    } finally {
      setIsCreating(false);
    }
  };

  if (!isDynamicStationsEnabled) {
    return (
      <div className="company-form-container preparation-stations-settings">
        <div className="settings-panel-header">
          <div>
            <h3 className="subtitle settings-title-inline">Areas de preparacion</h3>
            <p className="settings-option-meta">Configuracion de comandas para restaurante.</p>
          </div>
        </div>

        <div className="settings-option-row preparation-stations-free-card">
          <div className="settings-option-main">
            <div className="settings-icon-bubble settings-icon-bubble--info"><Info size={22} /></div>
            <div className="settings-option-copy">
              <span className="settings-option-title">Tu plan actual usa una estacion fija: Cocina.</span>
              <p>Actualiza a PRO para crear areas como Bebidas, Barra o Postres.</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="company-form-container preparation-stations-settings">
      <div className="settings-panel-header">
        <div>
          <h3 className="subtitle settings-title-inline">Areas de preparacion</h3>
          <p className="settings-option-meta">Define a que area se enviara la comanda de cada producto.</p>
        </div>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => refreshStations({ force: true })}
          disabled={isLoading}
        >
          <RefreshCcw size={16} /> Actualizar
        </button>
      </div>

      {error && <p className="preparation-stations-error">{error}</p>}

      {canManageStations && (
        <div className="preparation-station-editor">
          <input
            className="form-input"
            value={newStationName}
            onChange={(event) => setNewStationName(event.target.value)}
            placeholder="Ej. Bebidas, Barra, Postres"
            disabled={isCreating}
          />
          <button
            type="button"
            className="btn btn-save preparation-station-add-button"
            onClick={handleCreate}
            disabled={!newStationName.trim() || isCreating}
          >
            <Plus size={16} /> Agregar area
          </button>
        </div>
      )}

      {!canManageStations && (
        <div className="settings-option-row settings-option-row--disabled">
          <div className="settings-option-main">
            <div className="settings-icon-bubble settings-icon-bubble--muted"><Info size={22} /></div>
            <div className="settings-option-copy">
              <span className="settings-option-title">Solo lectura</span>
              <p>Tu usuario no tiene permisos suficientes para modificar areas.</p>
            </div>
          </div>
        </div>
      )}

      <div className="preparation-station-list">
        {stations.map((station) => (
          <StationRow
            key={station.id || station.code}
            station={station}
            canManageStations={canManageStations}
            onRename={(current, name) => updateStation(current, { name })}
            onToggle={toggleStation}
          />
        ))}
      </div>
    </div>
  );
}
