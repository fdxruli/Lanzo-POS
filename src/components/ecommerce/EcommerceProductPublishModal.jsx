import { useEffect, useMemo, useState } from 'react';
import { Link2, LoaderCircle, Save, Unlink, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { getEcommercePortal } from '../../services/ecommerce/ecommerceAdminService';

const MANUAL_SYNC_CONFIG = Object.freeze({
  name: 'manual',
  description: 'manual',
  category: 'manual',
  price: 'manual',
  image: 'manual'
});
const SOURCE_SYNC_CONFIG = Object.freeze({
  name: 'source',
  description: 'source',
  category: 'source',
  price: 'source',
  image: 'source'
});
const SYNC_FIELD_LABELS = Object.freeze({
  name: 'Nombre',
  description: 'Descripción',
  category: 'Categoría',
  price: 'Precio',
  image: 'Imagen'
});
const STOCK_MODES = Object.freeze(['hidden', 'status', 'exact']);

const emptyForm = {
  id: null,
  localProductRef: '',
  publicName: '',
  publicDescription: '',
  price: '',
  categoryName: '',
  isAvailable: true,
  isPublished: true,
  displayOrder: 0,
  imageUrl: null,
  stockMode: 'hidden',
  stockTracked: false,
  syncConfig: MANUAL_SYNC_CONFIG
};

const safeNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const publicUrl = (value) => {
  const text = typeof value === 'string' ? value.trim() : '';
  return /^https?:\/\//i.test(text) ? text : null;
};

const normalizeSyncConfig = (value, fallback = MANUAL_SYNC_CONFIG) => (
  Object.keys(SYNC_FIELD_LABELS).reduce((result, field) => {
    result[field] = value?.[field] === 'source' ? 'source' : fallback[field];
    return result;
  }, {})
);

const normalizeStockMode = (value) => (STOCK_MODES.includes(value) ? value : 'hidden');
const isProductStockTracked = (product = {}) => {
  if (
    product.sourceState === 'not_tracked'
    || product.trackStock === false
    || product.track_stock === false
  ) return false;

  const stockValue = product.stock ?? product.quantity;
  return (
    product.trackStock === true
    || product.track_stock === true
    || product.manageStock === true
    || product.manage_stock === true
    || product.batchManagement?.enabled === true
    || product.batch_management?.enabled === true
    || (stockValue !== null && stockValue !== undefined && stockValue !== '')
    || product.sourceState === 'in_stock'
    || product.sourceState === 'out_of_stock'
    || product.sourceState === 'unverified'
  );
};

const resolveStockMode = ({ isPro, featureEnabled, stockTracked, requestedMode }) => {
  if (!isPro || !featureEnabled || !stockTracked) return 'hidden';
  return normalizeStockMode(requestedMode);
};

export default function EcommerceProductPublishModal({
  open,
  editingProduct,
  localProducts,
  categoriesById,
  linkedRefs,
  isPro,
  limitReached,
  onClose,
  onSave
}) {
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [stockFeatureLoading, setStockFeatureLoading] = useState(false);
  const [stockVisibilityEnabled, setStockVisibilityEnabled] = useState(false);
  const allFieldsLinked = useMemo(
    () => Object.values(form.syncConfig).every((mode) => mode === 'source'),
    [form.syncConfig]
  );

  useEffect(() => {
    if (!open) return;
    if (!editingProduct) {
      setForm({
        ...emptyForm,
        isPublished: !limitReached,
        syncConfig: isPro ? SOURCE_SYNC_CONFIG : MANUAL_SYNC_CONFIG
      });
      return;
    }

    const linkedProduct = localProducts.find(
      (product) => String(product.id) === String(editingProduct.localProductRef || '')
    );
    setForm({
      id: editingProduct.id,
      localProductRef: editingProduct.localProductRef || '',
      publicName: editingProduct.publicName || '',
      publicDescription: editingProduct.publicDescription || '',
      price: String(editingProduct.price ?? ''),
      categoryName: editingProduct.categoryName || '',
      isAvailable: editingProduct.manualAvailable ?? editingProduct.isAvailable !== false,
      isPublished: editingProduct.isPublished !== false,
      displayOrder: editingProduct.displayOrder || 0,
      imageUrl: editingProduct.imageUrl || null,
      stockMode: normalizeStockMode(editingProduct.stockMode),
      stockTracked: linkedProduct
        ? isProductStockTracked(linkedProduct)
        : isProductStockTracked(editingProduct),
      syncConfig: isPro
        ? normalizeSyncConfig(editingProduct.syncConfig, MANUAL_SYNC_CONFIG)
        : MANUAL_SYNC_CONFIG
    });
  }, [editingProduct, isPro, limitReached, localProducts, open]);

  useEffect(() => {
    let active = true;
    if (!open || !isPro) {
      setStockFeatureLoading(false);
      setStockVisibilityEnabled(false);
      return () => { active = false; };
    }

    setStockFeatureLoading(true);
    void getEcommercePortal().then((result) => {
      if (!active) return;
      setStockVisibilityEnabled(
        result?.success === true && result?.features?.stockVisibility === true
      );
      setStockFeatureLoading(false);
    }, () => {
      if (!active) return;
      setStockVisibilityEnabled(false);
      setStockFeatureLoading(false);
    });

    return () => { active = false; };
  }, [isPro, open]);

  if (!open) return null;

  const chooseProduct = (event) => {
    const product = localProducts.find((item) => String(item.id) === event.target.value);
    if (!product) {
      setForm((current) => ({
        ...current,
        localProductRef: '',
        stockMode: 'hidden',
        stockTracked: false
      }));
      return;
    }
    const stockTracked = isProductStockTracked(product);
    setForm((current) => ({
      ...current,
      localProductRef: String(product.id),
      publicName: product.name || '',
      publicDescription: product.description || '',
      price: String(product.price ?? 0),
      categoryName: categoriesById.get(product.categoryId) || product.category || '',
      imageUrl: publicUrl(product.imageUrl || product.image),
      stockTracked,
      stockMode: stockTracked ? current.stockMode : 'hidden'
    }));
  };

  const setFieldMode = (field, linked) => {
    setForm((current) => ({
      ...current,
      syncConfig: {
        ...current.syncConfig,
        [field]: linked ? 'source' : 'manual'
      }
    }));
  };

  const setAllFieldsMode = (linked) => {
    setForm((current) => ({
      ...current,
      syncConfig: linked ? SOURCE_SYNC_CONFIG : MANUAL_SYNC_CONFIG
    }));
  };

  const submit = async (event) => {
    event.preventDefault();
    const price = Number(form.price);
    if (!form.localProductRef.trim()) return toast.error('Selecciona un producto del catálogo local.');
    if (!form.publicName.trim()) return toast.error('El nombre público es obligatorio.');
    if (!Number.isFinite(price) || price < 0) return toast.error('El precio público debe ser mayor o igual a cero.');
    if (!editingProduct && limitReached && form.isPublished) return toast.error('Plan Free ya alcanzó el límite de 10 productos.');

    setSaving(true);
    const saved = await onSave({
      id: form.id,
      sourceType: 'local_snapshot',
      localProductRef: form.localProductRef.trim(),
      publicName: form.publicName.trim(),
      publicDescription: form.publicDescription.trim() || null,
      price,
      categoryName: form.categoryName.trim() || null,
      isAvailable: form.isAvailable,
      manualAvailable: form.isAvailable,
      isPublished: form.isPublished,
      displayOrder: Math.max(0, Math.trunc(safeNumber(form.displayOrder, 0))),
      imageUrl: publicUrl(form.imageUrl),
      stockMode: resolveStockMode({
        isPro,
        featureEnabled: stockVisibilityEnabled,
        stockTracked: form.stockTracked,
        requestedMode: form.stockMode
      }),
      syncConfig: isPro ? normalizeSyncConfig(form.syncConfig) : MANUAL_SYNC_CONFIG,
      metadata: { source: 'admin_ui' }
    });
    setSaving(false);
    if (saved) onClose();
  };

  const stockSelectorDisabled = (
    stockFeatureLoading
    || !stockVisibilityEnabled
    || !form.stockTracked
  );

  return (
    <div className="ecom-admin-modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="ecom-admin-modal" role="dialog" aria-modal="true" aria-labelledby="ecom-product-title">
        <header>
          <div>
            <span className="ecom-admin-eyebrow">Catálogo público</span>
            <h3 id="ecom-product-title">{editingProduct ? 'Editar producto publicado' : 'Publicar producto'}</h3>
          </div>
          <button type="button" className="ecom-admin-icon-button" onClick={onClose} aria-label="Cerrar">
            <X size={20} />
          </button>
        </header>

        <form onSubmit={submit}>
          <label className="form-group ecom-admin-span-2">
            <span className="form-label">Producto del catálogo local *</span>
            <select className="form-input" value={form.localProductRef} onChange={chooseProduct} disabled={Boolean(editingProduct)} required>
              <option value="">Selecciona un producto</option>
              {localProducts.map((product) => {
                const ref = String(product.id);
                const linked = linkedRefs.has(ref) && ref !== editingProduct?.localProductRef;
                return (
                  <option key={ref} value={ref} disabled={linked}>
                    {product.name} — ${safeNumber(product.price).toFixed(2)}{linked ? ' (ya agregado)' : ''}
                  </option>
                );
              })}
            </select>
            <small className="ecom-admin-help">
              {isPro
                ? 'Lanzo Nube puede mantener vinculados los campos elegidos sin sobrescribir los campos manuales.'
                : 'Se guarda una copia pública; tu producto local no se modifica.'}
            </small>
          </label>

          {isPro && (
            <fieldset className="ecom-admin-sync-fields ecom-admin-span-2">
              <legend>Vinculación con el producto local</legend>
              <label className="ecom-admin-sync-master">
                <input
                  type="checkbox"
                  checked={allFieldsLinked}
                  onChange={(event) => setAllFieldsMode(event.target.checked)}
                />
                <span>
                  <strong>Mantener sincronizado con el producto local</strong>
                  <small>Los campos manuales nunca se sobrescriben.</small>
                </span>
              </label>
              <div className="ecom-admin-sync-field-grid">
                {Object.entries(SYNC_FIELD_LABELS).map(([field, label]) => {
                  const linked = form.syncConfig[field] === 'source';
                  return (
                    <label key={field} className={linked ? 'is-linked' : 'is-manual'}>
                      <input
                        type="checkbox"
                        checked={linked}
                        onChange={(event) => setFieldMode(field, event.target.checked)}
                      />
                      {linked ? <Link2 size={15} /> : <Unlink size={15} />}
                      <span>
                        <strong>{label}</strong>
                        <small>{linked ? 'Sincronizado con el producto local' : 'Este campo se administra manualmente'}</small>
                      </span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
          )}

          <label className="form-group">
            <span className="form-label">Nombre público *</span>
            <input className="form-input" value={form.publicName} disabled={isPro && form.syncConfig.name === 'source'} onChange={(event) => setForm((current) => ({ ...current, publicName: event.target.value }))} maxLength={160} required />
          </label>
          <label className="form-group">
            <span className="form-label">Precio público *</span>
            <input className="form-input" type="number" min="0" step="0.01" value={form.price} disabled={isPro && form.syncConfig.price === 'source'} onChange={(event) => setForm((current) => ({ ...current, price: event.target.value }))} required />
          </label>
          <label className="form-group">
            <span className="form-label">Categoría pública</span>
            <input className="form-input" value={form.categoryName} disabled={isPro && form.syncConfig.category === 'source'} onChange={(event) => setForm((current) => ({ ...current, categoryName: event.target.value }))} maxLength={120} />
          </label>
          <label className="form-group">
            <span className="form-label">Orden</span>
            <input className="form-input" type="number" min="0" step="1" value={form.displayOrder} onChange={(event) => setForm((current) => ({ ...current, displayOrder: event.target.value }))} />
          </label>
          <label className="form-group ecom-admin-span-2">
            <span className="form-label">Descripción pública</span>
            <textarea className="form-textarea" rows={4} value={form.publicDescription} disabled={isPro && form.syncConfig.description === 'source'} onChange={(event) => setForm((current) => ({ ...current, publicDescription: event.target.value }))} maxLength={1000} />
          </label>

          {isPro && (
            <label className="form-group ecom-admin-span-2">
              <span className="form-label">Visibilidad del inventario</span>
              <select
                className="form-input"
                value={stockSelectorDisabled ? 'hidden' : form.stockMode}
                disabled={stockSelectorDisabled}
                onChange={(event) => setForm((current) => ({
                  ...current,
                  stockMode: normalizeStockMode(event.target.value)
                }))}
              >
                <option value="hidden">Ocultar stock</option>
                <option value="status">Mostrar Disponible / Agotado</option>
                <option value="exact">Mostrar cantidad exacta</option>
              </select>
              <small className="ecom-admin-help">
                {stockFeatureLoading
                  ? 'Validando la función de inventario público…'
                  : !stockVisibilityEnabled
                    ? 'La visibilidad de inventario no está habilitada para esta licencia.'
                    : !form.stockTracked
                      ? 'Este producto no controla inventario; el stock permanecerá oculto.'
                      : 'La disponibilidad pública también respeta el control manual del producto.'}
              </small>
            </label>
          )}

          <div className="ecom-admin-modal-toggles ecom-admin-span-2">
            <label><input type="checkbox" checked={form.isAvailable} onChange={(event) => setForm((current) => ({ ...current, isAvailable: event.target.checked }))} /> Disponible manualmente para clientes</label>
            <label><input type="checkbox" checked={form.isPublished} onChange={(event) => setForm((current) => ({ ...current, isPublished: event.target.checked }))} disabled={!editingProduct && limitReached} /> Publicado</label>
          </div>
          {isPro && (
            <small className="ecom-admin-help ecom-admin-span-2">
              La disponibilidad pública requiere que el producto esté publicado, habilitado manualmente y disponible en la fuente local.
            </small>
          )}

          <footer className="ecom-admin-span-2">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancelar</button>
            <button type="submit" className="btn btn-primary" disabled={saving || stockFeatureLoading}>
              {saving ? <LoaderCircle className="ecom-admin-spin" size={17} /> : <Save size={17} />}
              Guardar producto
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}

export const ecommerceProductPublishModalInternals = Object.freeze({
  MANUAL_SYNC_CONFIG,
  SOURCE_SYNC_CONFIG,
  normalizeSyncConfig,
  normalizeStockMode,
  isProductStockTracked,
  resolveStockMode
});
