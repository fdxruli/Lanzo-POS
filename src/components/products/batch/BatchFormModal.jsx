import React from 'react';
import { useBatchFormController } from './hooks/useBatchFormController';
import RetailBatchFields from './fieldsets/RetailBatchFields';
import PharmacyBatchFields from './fieldsets/PharmacyBatchFields';
import FruteriaBatchFields from './fieldsets/FruteriaBatchFields';
import RestaurantBatchFields from './fieldsets/RestaurantBatchFields';

function RubroFieldset(props) {
  const { rubroGroup } = props;

  if (rubroGroup === 'pharmacy') {
    return <PharmacyBatchFields {...props} />;
  }

  if (rubroGroup === 'fruteria') {
    return <FruteriaBatchFields {...props} />;
  }

  if (rubroGroup === 'restaurant') {
    return <RestaurantBatchFields {...props} />;
  }

  return <RetailBatchFields {...props} />;
}

export default function BatchFormModal({
  product,
  batchToEdit,
  onClose,
  onSave,
  features,
  menu,
  rubroGroup
}) {
  const {
    formValues,
    isEditing,
    firstInputRef,
    tallaInputRef,
    setFieldValue,
    handleProcessSave
  } = useBatchFormController({
    product,
    batchToEdit,
    onClose,
    onSave,
    features,
    rubroGroup,
    menu
  });

  const idPrefix = `batch-${String(isEditing ? batchToEdit?.id : product?.id || 'new')
    .replace(/[^a-zA-Z0-9_-]/g, '-')}`;
  const payFromCajaId = `${idPrefix}-pay-from-caja`;

  return (
    <div className="modal" style={{ display: 'flex', zIndex: 9999 }}>
      <div className="modal-content batch-form-modal">
        <h2 className="modal-title">
          {isEditing ? 'Editar' : 'Registrar'} {features.hasVariants ? 'Variante' : 'Lote'}
        </h2>
        <p>
          Producto: <strong>{product.name}</strong>
        </p>

        <form>
          <RubroFieldset
            rubroGroup={rubroGroup}
            formValues={formValues}
            setFieldValue={setFieldValue}
            features={features}
            firstInputRef={firstInputRef}
            tallaInputRef={tallaInputRef}
            idPrefix={idPrefix}
          />

          <div style={{ display: 'flex', gap: '10px' }}>
            <div className="form-group" style={{ flex: 1 }}>
              <label htmlFor={`${idPrefix}-cost`}>Costo Unitario ($)</label>
              <input
                id={`${idPrefix}-cost`}
                type="number"
                step="0.01"
                value={formValues.cost}
                onChange={(event) => setFieldValue('cost', event.target.value)}
                className="form-input"
              />
            </div>
            <div className="form-group" style={{ flex: 1 }}>
              <label htmlFor={`${idPrefix}-price`}>Precio Venta ($)</label>
              <input
                id={`${idPrefix}-price`}
                type="number"
                step="0.01"
                value={formValues.price}
                onChange={(event) => setFieldValue('price', event.target.value)}
                className="form-input"
              />
            </div>
            {!features.hasVariants && !isEditing && (
              <div style={{ marginTop: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <input
                  type="checkbox"
                  id={`${idPrefix}-update-price`}
                  checked={formValues.updateGlobalPrice}
                  onChange={(e) => setFieldValue('updateGlobalPrice', e.target.checked)}
                />
                <label
                  htmlFor={`${idPrefix}-update-price`}
                  style={{ fontSize: '0.85rem', color: 'var(--text-color, #333)', cursor: 'pointer', margin: 0 }}
                >
                  Actualizar precio base del producto
                </label>
              </div>
            )}
          </div>

          <div className="form-group">
            <label htmlFor={`${idPrefix}-stock`}>Cantidad (Stock) *</label>
            <input
              id={`${idPrefix}-stock`}
              type="number"
              min="0"
              step="1"
              value={formValues.stock}
              onChange={(event) => setFieldValue('stock', event.target.value)}
              className="form-input"
              style={{ fontSize: '1.2rem', fontWeight: 'bold' }}
            />
          </div>

          <div className="form-group">
            <label htmlFor={`${idPrefix}-supplier`}>Proveedor / Origen (Trazabilidad)</label>
            <input
              id={`${idPrefix}-supplier`}
              type="text"
              placeholder="Nombre del proveedor, RFC o folio de factura"
              value={formValues.supplier}
              onChange={(event) => setFieldValue('supplier', event.target.value)}
              className="form-input"
            />
          </div>

          <div className="form-group">
            <label htmlFor={`${idPrefix}-notes`}>Notas</label>
            <textarea
              id={`${idPrefix}-notes`}
              placeholder="Detalles de compra..."
              value={formValues.notes}
              onChange={(event) => setFieldValue('notes', event.target.value)}
            />
          </div>

          {!isEditing && (
            <div
              className="form-group-checkbox"
              role="button"
              tabIndex={0}
              aria-pressed={formValues.pagadoDeCaja}
              onClick={() => setFieldValue('pagadoDeCaja', !formValues.pagadoDeCaja)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  setFieldValue('pagadoDeCaja', !formValues.pagadoDeCaja);
                }
              }}
              style={{
                marginTop: '15px',
                padding: '12px 15px',
                backgroundColor: formValues.pagadoDeCaja
                  ? 'rgba(3, 105, 161, 0.1)'
                  : 'var(--card-background-color, #fff)',
                border: `2px solid ${formValues.pagadoDeCaja
                  ? 'var(--primary-color, #0369a1)'
                  : 'var(--border-color, #e2e8f0)'}`,
                borderRadius: '8px',
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                cursor: 'pointer',
                transition: 'background-color 0.2s ease, border-color 0.2s ease'
              }}
            >
              <input
                type="checkbox"
                id={payFromCajaId}
                checked={formValues.pagadoDeCaja}
                onChange={(event) => setFieldValue('pagadoDeCaja', event.target.checked)}
                onClick={(event) => event.stopPropagation()}
                style={{
                  width: '18px',
                  height: '18px',
                  cursor: 'pointer'
                }}
              />
              <label
                htmlFor={payFromCajaId}
                style={{
                  fontSize: '1rem',
                  fontWeight: formValues.pagadoDeCaja ? '600' : 'normal',
                  color: formValues.pagadoDeCaja ? 'var(--primary-color, #0369a1)' : 'inherit',
                  margin: 0,
                  cursor: 'pointer',
                  userSelect: 'none'
                }}
              >
                Pagar con dinero de Caja
              </label>
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '15px' }}>
            {!isEditing && (
              <button
                type="button"
                className="btn btn-save"
                onClick={() => handleProcessSave(false)}
                style={{ backgroundColor: 'var(--secondary-color)' }}
              >
                Guardar y Agregar Otra Talla/Lote
              </button>
            )}

            <div style={{ display: 'flex', gap: '10px' }}>
              <button
                type="button"
                className="btn btn-cancel"
                onClick={onClose}
                style={{ flex: 1 }}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => handleProcessSave(true)}
                style={{ flex: 1 }}
              >
                {isEditing ? 'Actualizar' : 'Guardar y Cerrar'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
