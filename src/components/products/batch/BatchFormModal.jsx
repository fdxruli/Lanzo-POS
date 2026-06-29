import { useCallback, useState } from 'react';
import {
  X,
  Save,
  Plus,
  DollarSign,
  Package,
  FileText,
  Truck,
  Wallet,
  Tag
} from 'lucide-react';
import { useBatchFormController } from './hooks/useBatchFormController';
import RetailBatchFields from './fieldsets/RetailBatchFields';
import PharmacyBatchFields from './fieldsets/PharmacyBatchFields';
import FruteriaBatchFields from './fieldsets/FruteriaBatchFields';
import RestaurantBatchFields from './fieldsets/RestaurantBatchFields';
import { getBatchStockInputProps } from './utils/batchStockInput';
import { useDismissibleHistoryLayer } from '../../../hooks/useDismissibleHistoryLayer';
import './BatchFormModal.css'; // Asegúrate de importar los nuevos estilos

function RubroFieldset(props) {
  const { rubroGroup } = props;

  if (rubroGroup === 'pharmacy') return <PharmacyBatchFields {...props} />;
  if (rubroGroup === 'fruteria') return <FruteriaBatchFields {...props} />;
  if (rubroGroup === 'restaurant') return <RestaurantBatchFields {...props} />;
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
  const [showManualExpiry, setShowManualExpiry] = useState(false);

  const handleDismiss = useCallback(() => {
    onClose();
  }, [onClose]);

  const dismissModal = useDismissibleHistoryLayer({
    isOpen: true,
    onDismiss: handleDismiss,
    layerId: 'batch-form-modal'
  });

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
    onClose: dismissModal,
    onSave,
    features,
    rubroGroup,
    menu
  });

  const idPrefix = `batch-${String(isEditing ? batchToEdit?.id : product?.id || 'new').replace(/[^a-zA-Z0-9_-]/g, '-')}`;
  const payFromCajaId = `${idPrefix}-pay-from-caja`;
  const stockInputProps = getBatchStockInputProps(product, rubroGroup, features);

  return (
    <div className="ui-modal ui-modal--high batch-form-modal-overlay" role="dialog" aria-modal="true" aria-label={isEditing ? 'Editar lote' : 'Registrar lote'}>
      <div className="ui-modal__content ui-modal__content--xl batch-modal-wrapper">

        {/* ENCABEZADO */}
        <div className="batch-modal-header">
          <div className="batch-modal-header-info">
            <h2>
              {features.hasVariants ? <Tag size={24} className="text-primary" /> : <Package size={24} className="text-primary" />}
              {isEditing ? 'Editar' : 'Registrar'} {features.hasVariants ? 'Variante' : 'Lote'}
            </h2>
            <p className="batch-modal-subtitle">
              Producto: <strong>{product.name}</strong>
            </p>
          </div>
          <button type="button" className="btn-close-modal" onClick={dismissModal} aria-label="Cerrar modal">
            <X size={24} />
          </button>
        </div>

        <form className="batch-modal-form">
          {/* CUERPO DEL FORMULARIO CON SCROLL */}
          <div className="batch-form-scroll-area">
            <div className="batch-form-grid">

              {/* CAMPOS DINÁMICOS POR RUBRO (Ocupan todo el ancho) */}
              <div className="col-span-full">
                <RubroFieldset
                  rubroGroup={rubroGroup}
                  formValues={formValues}
                  setFieldValue={setFieldValue}
                  features={features}
                  firstInputRef={firstInputRef}
                  tallaInputRef={tallaInputRef}
                  idPrefix={idPrefix}
                  product={product}
                />
              </div>

              {/* SECCIÓN PRECIOS/COSTOS (Fondo resaltado) */}
              <div className="col-span-full price-cost-group">
                <div className="form-group field-with-icon batch-form-field--compact">
                  <label htmlFor={`${idPrefix}-cost`}>
                    <DollarSign size={16} /> Costo Unitario
                  </label>
                  <input
                    id={`${idPrefix}-cost`}
                    type="number"
                    step="0.01"
                    value={formValues.cost}
                    onChange={(event) => setFieldValue('cost', event.target.value)}
                    className="form-input"
                    placeholder="0.00"
                  />
                </div>
                <div className="form-group field-with-icon batch-form-field--compact">
                  <label htmlFor={`${idPrefix}-price`}>
                    <Tag size={16} /> Precio de Venta
                  </label>
                  <input
                    id={`${idPrefix}-price`}
                    type="number"
                    step="0.01"
                    value={formValues.price}
                    onChange={(event) => setFieldValue('price', event.target.value)}
                    className="form-input"
                    placeholder="0.00"
                  />
                </div>

                {/* CHECKBOX ACTUALIZAR PRECIO GLOBAL */}
                {!features.hasVariants && !isEditing && (
                  <div className="col-span-full batch-update-price-row">
                    <input
                      type="checkbox"
                      id={`${idPrefix}-update-price`}
                      checked={formValues.updateGlobalPrice}
                      onChange={(e) => setFieldValue('updateGlobalPrice', e.target.checked)}
                      className="batch-update-price-checkbox"
                    />
                    <label
                      htmlFor={`${idPrefix}-update-price`}
                      className="batch-update-price-label"
                    >
                      Actualizar precio base del producto en el catálogo
                    </label>
                  </div>
                )}
              </div>

              {/* CONTROL FÍSICO DE LOTES (STRICT / SHELF_LIFE) */}
              {(product.expirationMode === 'STRICT' || product.expirationMode === 'SHELF_LIFE') && (
                <div className="col-span-full price-cost-group batch-expiration-panel batch-expiration-panel--warning">
                  <h4 className="batch-expiration-title">Control Fisico y Caducidad</h4>
                  
                  {product.expirationMode === 'STRICT' && (
                    <div className="form-group field-with-icon batch-form-field--spaced">
                      <label htmlFor={`${idPrefix}-manufacturerBatchId`}>
                        <Package size={16} /> Lote Fabricante (Alfanumérico) *
                      </label>
                      <input
                        id={`${idPrefix}-manufacturerBatchId`}
                        type="text"
                        value={formValues.manufacturerBatchId}
                        onChange={(event) => setFieldValue('manufacturerBatchId', event.target.value)}
                        className={`form-input ${!formValues.manufacturerBatchId ? 'batch-required-input' : ''}`}
                        placeholder="Ej: L-102938"
                        required
                      />
                    </div>
                  )}

                  {product.expirationMode === 'STRICT' && (
                    <div className="form-group field-with-icon batch-form-field--spaced">
                      <label htmlFor={`${idPrefix}-expiryDate`} className="batch-required-label">
                        <Package size={16} /> Fecha de Caducidad / Producción *
                      </label>
                      <input
                        id={`${idPrefix}-expiryDate`}
                        type="date"
                        value={formValues.expiryDate}
                        onChange={(event) => setFieldValue('expiryDate', event.target.value)}
                        className={`form-input ${!formValues.expiryDate ? 'batch-required-input' : ''}`}
                        required
                      />
                      {!formValues.expiryDate && (
                        <small className="batch-required-help">
                          ⚠️ Obligatorio en modo STRICT.
                        </small>
                      )}
                    </div>
                  )}

                  {product.expirationMode === 'SHELF_LIFE' && (
                    <div className="form-group field-with-icon batch-form-field--spaced">
                      {!showManualExpiry ? (
                        <div className="batch-shelf-life-info">
                          <div className="batch-shelf-life-title">
                            ℹ️ Caducidad automática: +{product?.shelfLifeValue ?? '?'} {product?.shelfLifeUnit === 'months' ? 'meses' : 'días'} a partir de hoy.
                          </div>
                          <button
                            type="button"
                            onClick={() => setShowManualExpiry(true)}
                            className="batch-link-button"
                          >
                            Ajustar manualmente
                          </button>
                        </div>
                      ) : (
                        <>
                          <label htmlFor={`${idPrefix}-expiryDate`} className="batch-required-label">
                            <Package size={16} /> Fecha de caducidad manual (Opcional)
                          </label>
                          <input
                            id={`${idPrefix}-expiryDate`}
                            type="datetime-local"
                            value={formValues.expiryDate}
                            onChange={(event) => setFieldValue('expiryDate', event.target.value)}
                            className="form-input"
                          />
                          <small className="batch-manual-expiry-help">
                            Se guardará exactamente esta fecha; no se sumará la vida útil.
                          </small>
                          <button
                            type="button"
                            onClick={() => {
                              setShowManualExpiry(false);
                              setFieldValue('expiryDate', '');
                            }}
                            className="batch-link-button"
                          >
                            Cancelar ajuste manual
                          </button>
                        </>
                      )}
                    </div>
                  )}

                  {['pharmacy', 'retail'].includes(rubroGroup) && (
                    <div className="form-group field-with-icon batch-form-field--compact">
                      <label htmlFor={`${idPrefix}-pao`}>
                        <Package size={16} /> PAO (Period After Opening) - Meses
                      </label>
                      <input
                        id={`${idPrefix}-pao`}
                        type="number"
                        min="1"
                        value={formValues.pao}
                        onChange={(event) => setFieldValue('pao', event.target.value)}
                        className="form-input"
                        placeholder="Ej: 12"
                      />
                    </div>
                  )}
                </div>
              )}

              {/* CANTIDAD (Stock) */}
              <div className="form-group field-with-icon batch-form-field--compact">
                <label htmlFor={`${idPrefix}-stock`}>
                  <Package size={16} /> Cantidad Inicial (Stock) *
                </label>
                <input
                  id={`${idPrefix}-stock`}
                  type="number"
                  min="0"
                  step={stockInputProps.step}
                  inputMode={stockInputProps.inputMode}
                  value={formValues.stock}
                  onChange={(event) => setFieldValue('stock', event.target.value)}
                  className="form-input batch-stock-input"
                />
              </div>

              {/* PROVEEDOR */}
              <div className="form-group field-with-icon batch-form-field--compact">
                <label htmlFor={`${idPrefix}-supplier`}>
                  <Truck size={16} /> Proveedor / Origen
                </label>
                <input
                  id={`${idPrefix}-supplier`}
                  type="text"
                  placeholder="Nombre, RFC o Factura..."
                  value={formValues.supplier}
                  onChange={(event) => setFieldValue('supplier', event.target.value)}
                  className="form-input"
                />
              </div>

              {/* NOTAS ADICIONALES */}
              <div className="form-group field-with-icon col-span-full batch-form-field--compact">
                <label htmlFor={`${idPrefix}-notes`}>
                  <FileText size={16} /> Notas y Detalles
                </label>
                <textarea
                  id={`${idPrefix}-notes`}
                  rows="2"
                  placeholder="Observaciones de compra o estado de la mercancía..."
                  value={formValues.notes}
                  onChange={(event) => setFieldValue('notes', event.target.value)}
                  className="form-input"
                />
              </div>

              {/* OPCIÓN: PAGAR DE CAJA */}
              {!isEditing && (
                <div className="col-span-full">
                  <div
                    className={`caja-payment-toggle ${formValues.pagadoDeCaja ? 'active' : ''}`}
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
                  >
                    <input
                      type="checkbox"
                      id={payFromCajaId}
                      checked={formValues.pagadoDeCaja}
                      onChange={(event) => setFieldValue('pagadoDeCaja', event.target.checked)}
                      onClick={(event) => event.stopPropagation()}
                    />
                    <label htmlFor={payFromCajaId}>
                      <Wallet size={20} />
                      Descontar este pago del dinero en Caja
                    </label>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* FOOTER FIJO (Botones de Acción) */}
          <div className="batch-footer-fixed">
            <div className="batch-footer-actions">

              {!isEditing && (
                <button
                  type="button"
                  className="ui-button ui-button--secondary btn btn-save batch-secondary-save-button"
                  onClick={() => handleProcessSave(false)}
                >
                  <Plus size={18} />
                  Guardar y Agregar Otro
                </button>
              )}

              <button
                type="button"
                className="ui-button ui-button--ghost btn btn-cancel"
                onClick={dismissModal}
              >
                Cancelar
              </button>

              <button
                type="button"
                className="ui-button ui-button--primary btn btn-primary"
                onClick={() => handleProcessSave(true)}
              >
                <Save size={18} />
                {isEditing ? 'Actualizar' : 'Guardar y Cerrar'}
              </button>

            </div>
          </div>
        </form>
      </div>
    </div>
  );
}