import { useId } from 'react';
import { showConfirmModal } from '../../../../services/utils';

const EXPIRING_MODES = new Set(['STRICT', 'SHELF_LIFE']);

export default function RetailExpirationSection({ common }) {
  const inputId = useId();
  const modeInputId = `${inputId}-expiration-mode`;
  const shelfLifeInputId = `${inputId}-shelf-life`;
  const shelfLifeUnitInputId = `${inputId}-shelf-life-unit`;

  const handleExpirationModeChange = async (event) => {
    const newValue = event.target.value;
    const currentMode = common.expirationMode;

    if (newValue === currentMode) return;

    if (EXPIRING_MODES.has(currentMode) && newValue === 'NONE') {
      const confirmPurge = await showConfirmModal(
        'Existen lotes activos con fechas de caducidad. ¿Deseas purgar estas fechas o cancelar el cambio?',
        {
          title: 'Purgar caducidades',
          confirmButtonText: 'Sí, purgar',
          cancelButtonText: 'Cancelar'
        }
      );

      if (!confirmPurge) return;
      common.setPendingBatchPurge(true);
    }

    common.setExpirationMode(newValue);

    if (newValue === 'SHELF_LIFE') {
      if (!common.shelfLifeUnit) {
        common.setShelfLifeUnit('days');
      }
      return;
    }

    common.setShelfLifeValue('');
    common.setShelfLifeUnit(null);
  };

  return (
    <section className="product-form-section product-form-section--nested">
      <div className="product-form-section__header">
        <div className="product-form-section__heading">
          <h4 className="product-form-section__title">Modo de caducidad</h4>
          <p className="product-form-section__subtitle">
            Define si los lotes requieren fecha o vida útil al recibir inventario.
          </p>
        </div>
      </div>

      <div className="form-group product-form-no-margin">
        <label className="form-label" htmlFor={modeInputId}>Control de caducidad</label>
        <select
          id={modeInputId}
          className="form-input"
          value={common.expirationMode}
          onChange={handleExpirationModeChange}
        >
          <option value="NONE">No controlar caducidad</option>
          <option value="STRICT">Estricto (requerir fecha al recibir)</option>
          <option value="SHELF_LIFE">Vida útil (días/meses desde recepción)</option>
        </select>
      </div>

      {common.expirationMode === 'SHELF_LIFE' && (
        <div className="product-form-grid product-form-grid--2" style={{ marginTop: '10px' }}>
          <div className="form-group product-form-no-margin">
            <label className="form-label" htmlFor={shelfLifeInputId}>Vida útil</label>
            <input
              id={shelfLifeInputId}
              type="number"
              className="form-input"
              min="1"
              value={common.shelfLifeValue}
              onChange={(event) => common.setShelfLifeValue(event.target.value)}
              placeholder="Ej. 5"
            />
          </div>
          <div className="form-group product-form-no-margin">
            <label className="form-label" htmlFor={shelfLifeUnitInputId}>Unidad de tiempo</label>
            <select
              id={shelfLifeUnitInputId}
              className="form-input"
              value={common.shelfLifeUnit || 'days'}
              onChange={(event) => common.setShelfLifeUnit(event.target.value)}
            >
              <option value="days">Días</option>
              <option value="months">Meses</option>
            </select>
          </div>
        </div>
      )}
    </section>
  );
}
