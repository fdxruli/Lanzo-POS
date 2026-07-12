import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  Crown,
  Eye,
  EyeOff,
  Globe2,
  Image as ImageIcon,
  Link2,
  LoaderCircle,
  Lock,
  PackagePlus,
  Palette,
  PauseCircle,
  Pencil,
  PlayCircle,
  RefreshCw,
  Save,
  Store
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useAppStore } from '../../store/useAppStore';
import { evaluateEcommercePortalAccess } from '../../pages/settingsPageAccess';
import { productRepository } from '../../services/products/productRepository';
import {
  getEcommercePortal,
  listPublishedProducts,
  saveEcommercePortal,
  savePublishedProduct,
  setProductPublished
} from '../../services/ecommerce/ecommerceAdminService';
import {
  ECOMMERCE_CATALOG_SYNC_REQUEST_EVENT
} from '../../services/ecommerce/ecommerceCatalogSyncService';
import EcommerceProductPublishModal from './EcommerceProductPublishModal';
import EcommerceCatalogSyncPanel, {
  EcommerceCatalogSyncBadge
} from './EcommerceCatalogSyncPanel';
import './EcommercePortalSettings.css';

const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,62})[a-z0-9]$/;
const STATUS_LABELS = {
  draft: 'Borrador',
  published: 'Publicado',
  paused: 'Pausado',
  disabled: 'Deshabilitado'
};
const STOCK_WARNING_COPY = Object.freeze({
  out_of_stock: 'Publicado sin stock',
  source_missing: 'Producto original no encontrado',
  inactive_source: 'Producto original inactivo',
  unverified: 'No se pudo verificar el stock'
});

const numberOr = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const publicUrl = (value) => {
  const text = typeof value === 'string' ? value.trim() : '';
  return /^https?:\/\//i.test(text) ? text : '';
};

const portalForm = (portal, profile) => ({
  name: portal?.name || profile?.name || '',
  headline: portal?.headline || '',
  description: portal?.description || '',
  whatsappPhone: portal?.whatsappPhone || profile?.phone || '',
  address: portal?.address || profile?.address || '',
  pickupEnabled: portal?.pickupEnabled !== false,
  deliveryEnabled: portal?.deliveryEnabled === true,
  minOrderTotal: String(portal?.minOrderTotal ?? 0),
  status: portal?.status || 'draft',
  slug: portal?.slug || '',
  logoUrl: portal?.logoUrl || publicUrl(profile?.logo)
});

function PlanBadge({ isPro }) {
  return (
    <span className={`ecom-admin-plan-badge ${isPro ? 'is-pro' : 'is-free'}`}>
      {isPro ? <Crown size={14} /> : <Store size={14} />}
      {isPro ? 'Lanzo Nube' : 'Plan Free'}
    </span>
  );
}

function StateMessage({ error, onRetry }) {
  return (
    <div
      className={`ecom-admin-state ${error ? 'is-error' : ''}`}
      role={error ? 'alert' : 'status'}
    >
      {error
        ? <AlertTriangle size={30} />
        : <LoaderCircle className="ecom-admin-spin" size={30} />}
      <strong>{error ? 'No se pudo cargar el portal' : 'Cargando portal online...'}</strong>
      <span>{error || 'Validando la licencia y la configuracion publicada.'}</span>
      {error && (
        <button type="button" className="btn btn-secondary" onClick={onRetry}>
          <RefreshCw size={16} /> Reintentar
        </button>
      )}
    </div>
  );
}

function StockReviewBanner({ snapshot }) {
  const outOfStockCount = Number(snapshot?.outOfStockCount || 0);
  const reviewCount = (
    Number(snapshot?.sourceMissingCount || 0)
    + Number(snapshot?.inactiveSourceCount || 0)
    + Number(snapshot?.unverifiedCount || 0)
  );

  if (outOfStockCount <= 0 && reviewCount <= 0) return null;

  return (
    <div className="ecom-admin-stock-alerts" aria-live="polite">
      {outOfStockCount > 0 && (
        <div className="ecom-admin-stock-alert" role="alert">
          <AlertTriangle size={21} aria-hidden="true" />
          <div>
            <strong>Productos publicados sin stock</strong>
            <p>
              {outOfStockCount === 1
                ? 'Tienes 1 producto publicado sin stock.'
                : `Tienes ${outOfStockCount} productos publicados que no cuentan con inventario disponible.`}
              {' '}Agrega existencias o despublicalos para evitar pedidos que no puedas completar.
            </p>
          </div>
        </div>
      )}
      {reviewCount > 0 && (
        <div className="ecom-admin-stock-alert is-review" role="status">
          <AlertTriangle size={21} aria-hidden="true" />
          <div>
            <strong>Algunos productos publicados requieren revision</strong>
            <p>
              Hay {reviewCount === 1 ? '1 producto' : `${reviewCount} productos`} cuya referencia o inventario no pudo confirmarse.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

export default function EcommercePortalSettings() {
  const companyProfile = useAppStore((state) => state.companyProfile);
  const canAccess = useAppStore((state) => state.canAccess);
  const licenseDetails = useAppStore((state) => state.licenseDetails);
  const currentDeviceRole = useAppStore((state) => state.currentDeviceRole);
  const currentStaffUser = useAppStore((state) => state.currentStaffUser);
  const isLicenseInitializing = useAppStore((state) => state._isInitializing);
  const stockSnapshot = useAppStore(
    (state) => state.ecommercePublishedStockAlertSnapshot
  );
  const stockLoading = useAppStore(
    (state) => state.ecommercePublishedStockAlertLoading
  );
  const loadStockAlerts = useAppStore(
    (state) => state.loadEcommercePublishedStockAlerts
  );
  const invalidateStockAlerts = useAppStore(
    (state) => state.invalidateEcommercePublishedStockAlerts
  );
  const reconcileStockProducts = useAppStore(
    (state) => state.reconcileEcommercePublishedStockAlertProducts
  );

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [savingPortal, setSavingPortal] = useState(false);
  const [portal, setPortal] = useState(null);
  const [plan, setPlan] = useState({ code: 'free_trial', name: 'Plan Free' });
  const [features, setFeatures] = useState({
    customSlug: false,
    maxPublishedProducts: 10,
    cloudCatalogSource: false
  });
  const [form, setForm] = useState(() => portalForm(null, companyProfile));
  const [products, setProducts] = useState([]);
  const [busyProductId, setBusyProductId] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState(null);
  const [loadingCatalog, setLoadingCatalog] = useState(false);
  const [localProducts, setLocalProducts] = useState([]);
  const [categoriesById, setCategoriesById] = useState(new Map());

  const authorizationPending = isLicenseInitializing
    || currentDeviceRole === null
    || (
      currentDeviceRole === 'staff'
      && currentStaffUser === null
      && licenseDetails === null
    );
  const canManageEcommercePortal = evaluateEcommercePortalAccess({
    canAccess,
    currentDeviceRole
  });
  const isPro = features.cloudCatalogSource === true
    || features.customSlug === true
    || plan.code === 'pro_monthly';
  const publishedCount = products.filter((product) => product.isPublished).length;
  const maxProducts = features.maxPublishedProducts < 0
    ? Number.MAX_SAFE_INTEGER
    : (features.maxPublishedProducts || 10);
  const limitReached = !isPro && publishedCount >= maxProducts;
  const linkedRefs = useMemo(
    () => new Set(products.map((item) => item.localProductRef).filter(Boolean)),
    [products]
  );
  const stockByPublishedProductId = useMemo(() => new Map(
    (stockSnapshot?.products || []).map((result) => [
      String(result.publishedProductId),
      result
    ])
  ), [stockSnapshot]);

  const evaluateStock = useCallback(async ({
    nextPortal,
    nextProducts,
    reason
  }) => {
    invalidateStockAlerts?.({ reason });
    return loadStockAlerts?.({
      force: true,
      reason,
      background: true,
      portal: nextPortal,
      publishedProducts: nextProducts
    });
  }, [invalidateStockAlerts, loadStockAlerts]);

  const loadProducts = useCallback(async () => {
    const result = await listPublishedProducts();
    if (!result.success) throw new Error(result.message);
    const nextProducts = result.products || [];
    setProducts(nextProducts);
    return nextProducts;
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    const result = await getEcommercePortal();
    if (!result.success) {
      setError(result.message);
      setLoading(false);
      return;
    }

    const nextPortal = result.portal || null;
    setPortal(nextPortal);
    setPlan(result.plan || { code: 'free_trial', name: 'Plan Free' });
    setFeatures(result.features || {
      customSlug: false,
      maxPublishedProducts: 10,
      cloudCatalogSource: false
    });
    setForm(portalForm(nextPortal, companyProfile));

    try {
      const nextProducts = nextPortal ? await loadProducts() : [];
      if (!nextPortal) setProducts([]);
      await evaluateStock({
        nextPortal,
        nextProducts,
        reason: 'portal-online-load'
      });
    } catch (productError) {
      setError(productError.message);
    }
    setLoading(false);
  }, [companyProfile, evaluateStock, loadProducts]);

  useEffect(() => {
    if (authorizationPending || !canManageEcommercePortal) return;
    void load();
  }, [authorizationPending, canManageEcommercePortal, load]);

  const updateForm = (field) => (event) => {
    const value = event.target.type === 'checkbox'
      ? event.target.checked
      : event.target.value;
    setForm((current) => ({ ...current, [field]: value }));
  };

  const validatePortal = (candidate) => {
    if (!candidate.name.trim()) return 'El nombre publico del negocio es obligatorio.';
    if (isPro && !SLUG_PATTERN.test(candidate.slug.trim())) {
      return 'El slug debe tener entre 3 y 64 caracteres, usar minusculas, numeros o guiones y no iniciar ni terminar con guion.';
    }
    const phone = candidate.whatsappPhone.replace(/\D/g, '');
    if (candidate.whatsappPhone.trim() && phone.length < 8) {
      return 'WhatsApp debe tener al menos 8 digitos.';
    }
    if (numberOr(candidate.minOrderTotal, -1) < 0) {
      return 'El pedido minimo no puede ser negativo.';
    }
    if (!candidate.pickupEnabled && !candidate.deliveryEnabled) {
      return 'Activa al menos recoger o domicilio.';
    }
    return null;
  };

  const savePortal = async (candidate, successMessage) => {
    const validationError = validatePortal(candidate);
    if (validationError) return toast.error(validationError);

    setSavingPortal(true);
    const result = await saveEcommercePortal({
      name: candidate.name.trim(),
      headline: candidate.headline.trim() || null,
      description: candidate.description.trim() || null,
      whatsappPhone: candidate.whatsappPhone.trim() || null,
      address: candidate.address.trim() || null,
      pickupEnabled: candidate.pickupEnabled,
      deliveryEnabled: candidate.deliveryEnabled,
      minOrderTotal: numberOr(candidate.minOrderTotal, 0),
      status: candidate.status,
      slug: candidate.slug.trim() || null,
      logoUrl: publicUrl(candidate.logoUrl) || null,
      templateCode: 'classic',
      metadata: { source: 'admin_ui' }
    });
    setSavingPortal(false);

    if (!result.success) return toast.error(result.message);
    const nextPortal = result.portal;
    setPortal(nextPortal);
    setPlan(result.plan || plan);
    setFeatures(result.features || features);
    setForm(portalForm(nextPortal, companyProfile));
    reconcileStockProducts?.({ portal: nextPortal, publishedProducts: products });
    await evaluateStock({
      nextPortal,
      nextProducts: products,
      reason: 'portal-mutated'
    });
    toast.success(successMessage);
    return true;
  };

  const createPortal = () => {
    const initial = portalForm(null, companyProfile);
    if (!initial.name.trim()) {
      return toast.error(
        'Primero agrega el nombre del negocio en Datos y Apariencia o en este formulario.'
      );
    }
    return savePortal(initial, 'Portal online creado correctamente.');
  };

  const submitPortal = async (event) => {
    event.preventDefault();
    await savePortal(
      form,
      portal ? 'Portal actualizado correctamente.' : 'Portal online creado correctamente.'
    );
  };

  const changeStatus = async (status) => {
    const next = { ...form, status };
    setForm(next);
    await savePortal(
      next,
      status === 'published' ? 'Portal publicado.' : 'Portal pausado.'
    );
  };

  const copyLink = async () => {
    const link = `${window.location.origin}/tienda/${portal.slug}`;
    try {
      await navigator.clipboard.writeText(link);
      toast.success('Link reservado copiado.');
    } catch {
      toast.error('No se pudo copiar el link en este dispositivo.');
    }
  };

  const loadLocalCatalog = async () => {
    if (localProducts.length > 0) return true;
    setLoadingCatalog(true);
    try {
      const catalogProducts = [];
      const visitedCursors = new Set();
      let cursor = null;

      while (true) {
        const cursorKey = cursor === null || cursor === undefined || cursor === ''
          ? null
          : String(cursor);

        if (cursorKey !== null) {
          if (visitedCursors.has(cursorKey)) break;
          visitedCursors.add(cursorKey);
        }

        const page = await productRepository.listProductsPage({
          limit: 500,
          status: 'active',
          cursor
        });

        if (!page || !Array.isArray(page.data)) {
          throw new Error('No se pudo leer el catalogo local.');
        }

        const pageProducts = page.data;
        catalogProducts.push(...pageProducts);

        const nextCursor = page.nextCursor;
        const nextCursorKey = nextCursor === null
          || nextCursor === undefined
          || nextCursor === ''
          ? null
          : String(nextCursor);

        if (
          nextCursorKey === null
          || pageProducts.length === 0
          || nextCursorKey === cursorKey
          || visitedCursors.has(nextCursorKey)
        ) {
          break;
        }

        cursor = nextCursor;
      }

      const categories = await productRepository.listCategories();
      const uniqueProducts = [];
      const productIds = new Set();

      catalogProducts.forEach((product) => {
        if (!product?.id || product.isActive === false) return;
        const productId = String(product.id);
        if (productIds.has(productId)) return;
        productIds.add(productId);
        uniqueProducts.push(product);
      });

      setLocalProducts(uniqueProducts);
      setCategoriesById(new Map(
        (categories || []).map((category) => [category.id, category.name])
      ));
      return true;
    } catch (catalogError) {
      toast.error(catalogError?.message || 'No se pudo leer el catalogo local.');
      return false;
    } finally {
      setLoadingCatalog(false);
    }
  };

  const openNewProduct = async () => {
    if (!portal) return toast.error('Primero crea el portal online.');
    if (limitReached) {
      return toast.error('Plan Free permite publicar hasta 10 productos.');
    }
    if (!(await loadLocalCatalog())) return;
    setEditingProduct(null);
    setModalOpen(true);
  };

  const openEditProduct = async (product) => {
    if (!(await loadLocalCatalog())) return;
    setEditingProduct(product);
    setModalOpen(true);
  };

  const refreshAfterProductMutation = async (reason) => {
    const nextProducts = await loadProducts();
    reconcileStockProducts?.({ portal, publishedProducts: nextProducts });
    await evaluateStock({ nextPortal: portal, nextProducts, reason });
    return nextProducts;
  };

  const requestCatalogSync = (productIds = [], reason = 'portal-product-change') => {
    if (!isPro) return;
    window.dispatchEvent(new CustomEvent(ECOMMERCE_CATALOG_SYNC_REQUEST_EVENT, {
      detail: {
        productIds,
        fullReconcile: productIds.length === 0,
        reason
      }
    }));
  };

  const saveProduct = async (payload) => {
    const result = await savePublishedProduct(payload);
    if (!result.success) {
      toast.error(result.message);
      return false;
    }
    await refreshAfterProductMutation('published-product-saved');
    requestCatalogSync([payload.localProductRef], 'published-product-saved');
    toast.success(payload.id ? 'Producto actualizado.' : 'Producto publicado.');
    return true;
  };

  const toggleProduct = async (product) => {
    if (!product.isPublished && limitReached) {
      return toast.error(
        'Plan Free permite publicar hasta 10 productos. Actualiza a Lanzo Nube para productos ilimitados.'
      );
    }
    setBusyProductId(product.id);
    const result = await setProductPublished(product.id, !product.isPublished);
    setBusyProductId(null);
    if (!result.success) return toast.error(result.message);
    await refreshAfterProductMutation('published-product-toggled');
    requestCatalogSync([product.localProductRef], 'published-product-toggled');
    toast.success(product.isPublished ? 'Producto despublicado.' : 'Producto publicado.');
  };

  if (authorizationPending) return <StateMessage />;
  if (!canManageEcommercePortal) {
    return (
      <StateMessage
        error="No tienes permiso para administrar el portal online."
        onRetry={() => window.location.reload()}
      />
    );
  }
  if (loading) return <StateMessage />;
  if (error) return <StateMessage error={error} onRetry={load} />;

  const reservedLink = portal
    ? `${window.location.origin}/tienda/${portal.slug}`
    : '';

  return (
    <div className="ecom-admin-page">
      <header className="ecom-admin-hero">
        <div>
          <span className="ecom-admin-kicker">
            <Globe2 size={16} /> Portal online
          </span>
          <h2>Tu tienda sencilla para compartir por WhatsApp</h2>
          <p>
            Configura lo que veran tus clientes. La sincronizacion PRO mantiene vinculados solo los campos elegidos.
          </p>
        </div>
        <PlanBadge isPro={isPro} />
      </header>

      <div className="ecom-admin-plan-copy">
        {isPro
          ? 'Lanzo Nube incluye catalogo ilimitado y sincronizacion automatica de los campos vinculados, sin sobrescribir personalizaciones manuales.'
          : 'Tu Plan Free incluye una mini tienda online con hasta 10 productos publicados y cache publico.'}
      </div>

      {!portal ? (
        <section className="ui-card ecom-admin-empty-card">
          <span className="ecom-admin-empty-icon"><Store size={34} /></span>
          <div>
            <span className="ecom-admin-eyebrow">Aun no existe un portal</span>
            <h3>Reserva el enlace de tu negocio</h3>
            <p>
              Se creara en borrador usando los datos guardados. La tienda publica todavia no se habilitara.
            </p>
          </div>
          <button
            type="button"
            className="btn btn-primary"
            onClick={createPortal}
            disabled={savingPortal}
          >
            {savingPortal
              ? <LoaderCircle className="ecom-admin-spin" size={17} />
              : <Store size={17} />}
            {' '}Crear portal online
          </button>
        </section>
      ) : (
        <section className="ui-card ecom-admin-status-card">
          <div className="ecom-admin-card-heading">
            <div>
              <span className="ecom-admin-eyebrow">Estado del portal</span>
              <h3>{portal.name}</h3>
            </div>
            <div className="ecom-admin-badges">
              <PlanBadge isPro={isPro} />
              <span className={`ecom-admin-status status-${portal.status}`}>
                {STATUS_LABELS[portal.status] || portal.status}
              </span>
            </div>
          </div>
          <div className="ecom-admin-link-box">
            <Globe2 size={22} />
            <div>
              <span>Link reservado</span>
              <strong>{reservedLink}</strong>
              <small>
                Revisión actual del catálogo: {portal.catalogRevision || 1}.
              </small>
            </div>
            <button type="button" className="btn btn-secondary" onClick={copyLink}>
              <Copy size={16} /> Copiar link
            </button>
          </div>
          <div className="ecom-admin-status-actions">
            <span><Globe2 size={18} /> Slug: <strong>{portal.slug}</strong></span>
            <button
              type="button"
              className={`btn ${portal.status === 'published' ? 'btn-secondary' : 'btn-primary'}`}
              onClick={() => changeStatus(
                portal.status === 'published' ? 'paused' : 'published'
              )}
              disabled={savingPortal}
            >
              {portal.status === 'published'
                ? <PauseCircle size={17} />
                : <PlayCircle size={17} />}
              {portal.status === 'published' ? 'Pausar portal' : 'Publicar portal'}
            </button>
          </div>
        </section>
      )}

      <form className="ui-card ecom-admin-form-card" onSubmit={submitPortal}>
        <div className="ecom-admin-card-heading">
          <div>
            <span className="ecom-admin-eyebrow">Datos publicos basicos</span>
            <h3>Informacion de tu tienda</h3>
            <p>Estos datos se muestran en la ruta publica.</p>
          </div>
          <Save size={22} />
        </div>
        <div className="ecom-admin-form-grid">
          <label className="form-group">
            <span className="form-label">Nombre publico *</span>
            <input
              className="form-input"
              value={form.name}
              onChange={updateForm('name')}
              maxLength={120}
              required
            />
          </label>
          <label className="form-group">
            <span className="form-label">Enlace / slug *</span>
            <div className="ecom-admin-input-icon">
              <Link2 size={16} />
              <input
                className="form-input"
                value={form.slug}
                onChange={updateForm('slug')}
                minLength={3}
                maxLength={64}
                placeholder={isPro ? 'mi-negocio' : 'Generado por el sistema'}
                readOnly={!isPro}
                disabled={!isPro}
              />
            </div>
            <small className="ecom-admin-help">
              {isPro
                ? 'En Lanzo Nube puedes personalizar el enlace de tu tienda.'
                : 'En Plan Free el enlace se genera automaticamente.'}
            </small>
          </label>
          <label className="form-group ecom-admin-span-2">
            <span className="form-label">Frase corta / headline</span>
            <input
              className="form-input"
              value={form.headline}
              onChange={updateForm('headline')}
              maxLength={160}
            />
          </label>
          <label className="form-group ecom-admin-span-2">
            <span className="form-label">Descripcion</span>
            <textarea
              className="form-textarea"
              value={form.description}
              onChange={updateForm('description')}
              rows={4}
              maxLength={1000}
            />
          </label>
          <label className="form-group">
            <span className="form-label">WhatsApp</span>
            <input
              className="form-input"
              type="tel"
              value={form.whatsappPhone}
              onChange={updateForm('whatsappPhone')}
              placeholder="961 000 0000"
            />
            <small className="ecom-admin-help">Minimo 8 digitos si agregas un numero.</small>
          </label>
          <label className="form-group">
            <span className="form-label">Pedido minimo</span>
            <input
              className="form-input"
              type="number"
              min="0"
              step="0.01"
              value={form.minOrderTotal}
              onChange={updateForm('minOrderTotal')}
            />
          </label>
          <label className="form-group ecom-admin-span-2">
            <span className="form-label">Direccion publica</span>
            <textarea
              className="form-textarea"
              value={form.address}
              onChange={updateForm('address')}
              rows={3}
              maxLength={500}
            />
          </label>
          <fieldset className="ecom-admin-delivery ecom-admin-span-2">
            <legend>Metodos de entrega</legend>
            <label>
              <input
                type="checkbox"
                checked={form.pickupEnabled}
                onChange={updateForm('pickupEnabled')}
              />
              <span><strong>Recoger</strong><small>El cliente recoge en el negocio.</small></span>
            </label>
            <label>
              <input
                type="checkbox"
                checked={form.deliveryEnabled}
                onChange={updateForm('deliveryEnabled')}
              />
              <span><strong>Domicilio</strong><small>El negocio coordina la entrega.</small></span>
            </label>
          </fieldset>
          <label className="form-group">
            <span className="form-label">Estado</span>
            <select
              className="form-input"
              value={form.status}
              onChange={updateForm('status')}
            >
              <option value="draft">Borrador</option>
              <option value="published">Publicado</option>
              <option value="paused">Pausado</option>
            </select>
          </label>
          <div className="form-group">
            <span className="form-label">Logo reutilizado</span>
            <div className="ecom-admin-logo">
              {publicUrl(form.logoUrl || companyProfile?.logo)
                ? (
                    <img
                      src={publicUrl(form.logoUrl || companyProfile?.logo)}
                      alt="Logo del portal"
                    />
                  )
                : <ImageIcon size={28} />}
              <span>Se usa el logo ya configurado. Esta fase no agrega nuevas subidas.</span>
            </div>
          </div>
        </div>
        <div className="ecom-admin-customization">
          <div>
            <Palette size={20} />
            <span>
              <strong>{isPro ? 'Personalizacion Portal PRO' : 'Plantilla fija de Plan Free'}</strong>
              <small>
                {isPro
                  ? 'Logo, portada, color principal y plantilla.'
                  : 'Configuracion basica con plantilla fija.'}
              </small>
            </span>
          </div>
          <span className="ecom-admin-locked">
            <Lock size={14} /> Disponible en una fase posterior de Portal PRO.
          </span>
        </div>
        <div className="ecom-admin-form-actions">
          <span><CheckCircle2 size={16} /> Los datos quedan separados del flujo POS.</span>
          <button type="submit" className="btn btn-primary" disabled={savingPortal}>
            {savingPortal
              ? <LoaderCircle className="ecom-admin-spin" size={17} />
              : <Save size={17} />}
            {' '}Guardar portal
          </button>
        </div>
      </form>

      <section
        id="ecommerce-published-products"
        className="ui-card ecom-admin-products-card"
        tabIndex={-1}
        aria-label="Productos publicados en portal"
      >
        <div className="ecom-admin-card-heading">
          <div>
            <span className="ecom-admin-eyebrow">Catalogo publico</span>
            <h3>Productos publicados en portal</h3>
            <p>
              {isPro
                ? `${publishedCount} productos publicados`
                : `${publishedCount} / ${maxProducts} productos publicados`}
              {stockLoading ? ' · Verificando stock...' : ''}
            </p>
          </div>
          <button
            type="button"
            className="btn btn-primary"
            onClick={openNewProduct}
            disabled={!portal || limitReached || loadingCatalog}
          >
            {loadingCatalog
              ? <LoaderCircle className="ecom-admin-spin" size={17} />
              : <PackagePlus size={17} />}
            {' '}Publicar producto
          </button>
        </div>

        <EcommerceCatalogSyncPanel
          isPro={isPro}
          products={products}
          catalogRevision={portal?.catalogRevision}
          onRefresh={loadProducts}
        />

        <StockReviewBanner snapshot={stockSnapshot} />

        {!isPro && (
          <div className={`ecom-admin-limit ${limitReached ? 'is-blocked' : ''}`}>
            <Lock size={17} /> Plan Free permite publicar hasta 10 productos. La sincronizacion automatica requiere Lanzo Nube.
          </div>
        )}
        {products.length === 0 ? (
          <div className="ecom-admin-products-empty">
            <PackagePlus size={30} />
            <strong>Aun no hay productos en el portal</strong>
            <span>Elige productos del catalogo local y crea un snapshot publico controlado.</span>
          </div>
        ) : (
          <div className="ecom-admin-product-list">
            {products.map((product) => {
              const stockResult = product.isPublished
                ? stockByPublishedProductId.get(String(product.id))
                : null;
              const warningText = STOCK_WARNING_COPY[stockResult?.status] || '';

              return (
                <article
                  key={product.id}
                  className={[
                    'ecom-admin-product',
                    product.isPublished ? '' : 'is-hidden',
                    warningText ? 'has-stock-warning' : ''
                  ].filter(Boolean).join(' ')}
                >
                  <span className="ecom-admin-product-image">
                    {product.imageUrl
                      ? <img src={product.imageUrl} alt="" />
                      : <Store size={22} />}
                  </span>
                  <div>
                    <div>
                      <strong>{product.publicName}</strong>
                      <span className={`ecom-admin-mini-status ${product.isPublished ? 'is-on' : ''}`}>
                        {product.isPublished ? 'Publicado' : 'Oculto'}
                      </span>
                      {isPro && (
                        <EcommerceCatalogSyncBadge status={product.syncStatus} />
                      )}
                    </div>
                    {warningText && (
                      <span
                        className={`ecom-admin-stock-warning status-${stockResult.status}`}
                        role="status"
                        aria-label={warningText}
                      >
                        <AlertTriangle size={15} aria-hidden="true" />
                        {warningText}
                      </span>
                    )}
                    <span>
                      {product.categoryName || 'Sin categoria'} · ${numberOr(product.price).toFixed(2)}
                    </span>
                    <small>
                      {product.isAvailable ? 'Disponible' : 'No disponible'}
                      {' · '}Manual: {product.manualAvailable === false ? 'desactivado' : 'activo'}
                      {' · '}Orden {product.displayOrder || 0}
                    </small>
                  </div>
                  <div className="ecom-admin-product-actions">
                    <button
                      type="button"
                      className="ecom-admin-icon-button"
                      onClick={() => openEditProduct(product)}
                      title="Editar"
                      aria-label={`Editar ${product.publicName}`}
                    >
                      <Pencil size={18} />
                    </button>
                    <button
                      type="button"
                      className="ecom-admin-icon-button"
                      onClick={() => toggleProduct(product)}
                      disabled={busyProductId === product.id}
                      title={product.isPublished ? 'Despublicar' : 'Publicar'}
                      aria-label={`${product.isPublished ? 'Despublicar' : 'Publicar'} ${product.publicName}`}
                    >
                      {busyProductId === product.id
                        ? <LoaderCircle className="ecom-admin-spin" size={18} />
                        : product.isPublished
                          ? <EyeOff size={18} />
                          : <Eye size={18} />}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <EcommerceProductPublishModal
        open={modalOpen}
        editingProduct={editingProduct}
        localProducts={localProducts}
        categoriesById={categoriesById}
        linkedRefs={linkedRefs}
        isPro={isPro}
        limitReached={limitReached}
        onClose={() => setModalOpen(false)}
        onSave={saveProduct}
      />
    </div>
  );
}
