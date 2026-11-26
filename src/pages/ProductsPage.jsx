import { usePublishBotScreen } from '../hooks/useBotScreenContext';
// src/pages/ProductsPage.jsx
import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { showConfirmModal, showMessageModal } from '../services/utils';
import ProductForm from '../components/products/ProductForm';
import ProductList from '../components/products/ProductList';
import CategoryManagerModal from '../components/products/CategoryManagerModal';
import CategoryManager from '../components/products/CategoryManager';
import IngredientManager from '../components/products/IngredientManager';
import VariantInventoryView from '../components/products/VarianteInvetoryView';
import PreparationStationsSettings from '../components/settings/PreparationStationsSettings';
import { useInventoryCatalogStore } from '../store/useInventoryCatalogStore';
import { broadcastDBChange } from '../services/products/productCatalogEvents';
import { useStatsStore } from '../store/useStatsStore';
import BatchManager from '../components/products/BatchManager';
import { useFeatureConfig } from '../hooks/useFeatureConfig';
import DailyPriceModal from '../components/products/DailyPriceModal';
import { useAppStore } from '../store/useAppStore';
import { productRepository } from '../services/products/productRepository';
import {
    migrateLegacyProductImages,
    prepareProductImageForCloud
} from '../services/products/productImageMigrationService';
import {
    getLicenseKeyFromDetails,
    isCloudProductsSyncEnabled
} from '../services/sync/syncConstants';
import { normalizeBusinessTypes } from '../utils/businessType';
import './ProductsPage.css';
import Logger from '../services/Logger';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useNavigationGuard } from '../hooks/useNavigationGuard';
import { useActorAccess } from '../services/auth/useActorAccess';
import { ADMIN_ROUTE_PATHS } from '../router/adminRoutePaths';
import { actorRuntimeController } from '../services/auth/actorRuntimeController';
import { classifyActorAuthorityError } from '../services/auth/actorAuthorityErrors';
import {
    clearProductFormDraft,
    createProductFormDraftScope,
    readProductFormDraft,
    saveProductFormDraft
} from '../services/products/productFormDraftCache';

const PRODUCT_FORM_EXIT_MESSAGE = 'Estás editando o creando un producto. Si sales ahora, los datos no guardados se perderán. ¿Seguro que quieres salir?';
const PRODUCT_IMAGE_MIGRATION_SESSION_PREFIX = 'lanzo:product-image-migration:';
const PRODUCT_SAVE_RESULT_UNKNOWN_CODES = new Set([
    'PRODUCT_SYNC_CONFIRMATION_MISSING',
    'PRODUCT_CATEGORY_CONFIRMATION_MISSING',
    'PRODUCT_CATEGORY_NOT_CONFIRMED'
]);
const getProductSaveErrorCode = (result, fallback) => {
    const candidate = result?.code || result?.error?.code;
    return typeof candidate === 'string' && /^[A-Z0-9_]{1,64}$/.test(candidate)
        ? candidate
        : fallback;
};
const getCategorySaveError = (result) => {
    const response = result?.response || result?.error?.details || result?.error?.response || {};
    const code = result?.code || result?.error?.code || response?.code;
    const rawMessage = result?.message || result?.error?.message || response?.message;
    const isCodeOnlyMessage = typeof rawMessage === 'string' && /^[A-Z0-9_]+$/.test(rawMessage.trim());
    const isAuthorizationError = /AUTH|PERMISSION|FORBIDDEN|NOT_AUTHORIZED|UNAUTHORIZED|permiso|autoriz/i.test(`${code || ''} ${rawMessage || ''}`)
        || ['401', '403', '42501'].includes(String(code || ''));

    let message = rawMessage;
    if (code === 'DUPLICATE_CATEGORY_NAME' && (!message || isCodeOnlyMessage)) {
        message = 'Ya existe una categoría activa con este nombre.';
    } else if (code === 'VERSION_CONFLICT') {
        message = 'La categoría cambió en otro dispositivo. Tus datos siguen en el formulario; cancela esta edición y vuelve a abrir la categoría para cargar y revisar los cambios actuales antes de guardarla de nuevo.';
        if (result?.categoryRefreshFailed) {
            message += ' No se pudo actualizar la lista local; sincroniza las categorías antes de reabrirla.';
        }
    } else if (isAuthorizationError && (!message || isCodeOnlyMessage || /AUTH|PERMISSION|FORBIDDEN|NOT_AUTHORIZED|UNAUTHORIZED/i.test(message))) {
        message = 'No tienes autorización para guardar categorías en la nube. Verifica tu sesión y permisos.';
    } else if (!message || isCodeOnlyMessage) {
        message = 'No se pudo guardar la categoría. Intenta de nuevo.';
    }

    const error = result?.error instanceof Error ? result.error : new Error(message);
    if (error.message !== message) error.message = message;
    if (code) error.code = code;
    error.field = result?.field || response?.field || error.field || null;
    error.response = response;
    return error;
};
const getProductImageMigrationSessionKey = (value) => {
    let hash = 2166136261;
    const input = String(value || '');
    for (let index = 0; index < input.length; index += 1) {
        hash ^= input.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return `${PRODUCT_IMAGE_MIGRATION_SESSION_PREFIX}${(hash >>> 0).toString(36)}`;
};

const isSafeLiaRecordId = (value) => {
    if (typeof value !== 'string' || !value.trim() || value.length > 180) return false;
    for (let index = 0; index < value.length; index += 1) {
        const code = value.charCodeAt(index);
        if (code < 32 || code === 127) return false;
    }
    return true;
};

export default function ProductsPage() {
    const [searchParams, setSearchParams] = useSearchParams();
    const location = useLocation();
    const navigate = useNavigate();
    const productFormDraftScope = createProductFormDraftScope(actorRuntimeController.getState());
    const [productFormDraft] = useState(() => readProductFormDraft(productFormDraftScope));
    const [showDailyPrice, setShowDailyPrice] = useState(false);
    const [activeTab, setActiveTab] = useState(() => productFormDraft?.activeTab || 'view-products');
  usePublishBotScreen('/productos', ({ 'add-product': 'add', 'view-products': 'list', 'variants-view': 'variants' })[activeTab] || activeTab);
    const features = useFeatureConfig();
    const companyProfile = useAppStore(state => state.companyProfile);
    const licenseDetails = useAppStore(state => state.licenseDetails);
    const initializeApp = useAppStore(state => state.initializeApp);
    const licenseKey = getLicenseKeyFromDetails(licenseDetails);
    // Subscribe to the actor runtime so a legitimate session restore/regrant
    // refreshes both the visible tab and its click-time permission check.
    const actorAccess = useActorAccess();
    const canAccess = actorAccess.canAccessPermission;
    const actorSnapshot = actorAccess.runtimeSnapshot;
    const currentLiaContextToken = useMemo(() => {
        const tenantOpaqueId = actorSnapshot?.tenant?.opaqueId || '';
        const actorKey = actorSnapshot?.actorKey || '';
        const sessionId = actorSnapshot?.sessionId || '';
        if (!tenantOpaqueId || !actorKey || !sessionId) return null;
        return JSON.stringify([tenantOpaqueId, actorKey, sessionId]);
    }, [actorSnapshot]);
    const liaProductReview = location.state?.liaProductReview || null;
    const canManageProducts = canAccess('products');
    const canManageInventory = canAccess('inventory');
    const canDeleteProducts = canManageProducts && canManageInventory;
    const cloudProductImagesEnabled = Boolean(
        licenseKey && isCloudProductsSyncEnabled(licenseDetails)
    );
    const businessTypes = companyProfile?.business_type;
    const hasRestaurantProductSettings = useMemo(() => (
        normalizeBusinessTypes(businessTypes || []).includes('food_service')
    ), [businessTypes]);
    const isApparel = (() => {
        const types = companyProfile?.business_type;
        if (Array.isArray(types)) return types.includes('apparel');
        return types === 'apparel';
    })();

    const adjustInventoryValue = useStatsStore(state => state.adjustInventoryValue);
    const categories = useInventoryCatalogStore((state) => state.categories);
    const products = useInventoryCatalogStore((state) => state.menu);
    const filters = useInventoryCatalogStore((state) => state.filters);
    const setFilters = useInventoryCatalogStore((state) => state.setFilters);
    const refreshData = useInventoryCatalogStore((state) => state.loadInitialProducts);
    const refreshCategories = useInventoryCatalogStore((state) => state.refreshCategories);

    const retryTenantVerification = useCallback(async ({ refreshCatalog = false } = {}) => {
        try {
            const verification = await initializeApp?.({ force: true });
            if (verification?.status !== 'ready') return false;
            if (!refreshCatalog) return true;
            const productsRefreshed = await refreshData();
            const categoriesRefreshed = await refreshCategories();
            return productsRefreshed !== false && categoriesRefreshed !== false;
        } catch (retryError) {
            Logger.warn('[Products] Verificación o reconciliación del catálogo pendiente:', retryError);
            return false;
        }
    }, [initializeApp, refreshCategories, refreshData]);

    const [editingProduct, setEditingProduct] = useState(() => productFormDraft?.productToEdit || null);
    const [productFormDraftValues, setProductFormDraftValues] = useState(() => productFormDraft?.values || null);
    const [isProductFormDirty, setIsProductFormDirty] = useState(() => Boolean(productFormDraft));
    const [isLoading, setIsLoading] = useState(false);
    const [showCategoryModal, setShowCategoryModal] = useState(false);
    const [selectNewCategoryOnCreate, setSelectNewCategoryOnCreate] = useState(false);
    const [selectedBatchProductId, setSelectedBatchProductId] = useState(null);
    const [liaReviewRecord, setLiaReviewRecord] = useState({
        status: 'idle', product: null, contextToken: null, referenceId: null
    });
    const [, setShowDataTransfer] = useState(false);
    const legacyImageMigrationRef = useRef({ licenseKey: null, running: false });
    const productCategoryCreateRequestRef = useRef(null);
    const [productCategoryCreateRequest, setProductCategoryCreateRequest] = useState(null);

    const liaReviewReference = liaProductReview?.recordReference;
    const isLiaReviewContextCurrent = Boolean(
        currentLiaContextToken && liaProductReview?.contextToken === currentLiaContextToken
    );
    const isLiaReviewReferenceValid = Boolean(
        liaReviewReference && ['product', 'batches'].includes(liaReviewReference.kind)
        && isSafeLiaRecordId(liaReviewReference.id)
    );
    const hasLiaReviewPermission = liaReviewReference?.kind === 'batches'
        ? canManageInventory
        : canManageProducts || canManageInventory;
    const liaReviewStateMatchesRequest = liaReviewRecord.contextToken === currentLiaContextToken
        && liaReviewRecord.referenceId === liaReviewReference?.id;
    const currentLiaReviewRecord = !isLiaReviewContextCurrent
        ? { status: 'context_changed', product: null }
        : !isLiaReviewReferenceValid
            ? { status: 'invalid_reference', product: null }
            : !hasLiaReviewPermission
                ? { status: 'permission_denied', product: null }
                : !liaReviewStateMatchesRequest
                    ? { status: 'loading', product: null }
                    : liaReviewRecord;
    const isLiaProductReview = Boolean(liaProductReview)
        && liaReviewReference?.kind === 'product'
        && currentLiaReviewRecord.status === 'found'
        && String(currentLiaReviewRecord.product?.id) === liaReviewReference.id;
    const productsForSale = liaProductReview
        ? (isLiaProductReview ? [currentLiaReviewRecord.product] : [])
        : products;

    const invalidateProductCategoryCreateRequest = useCallback(() => {
        productCategoryCreateRequestRef.current = null;
        setProductCategoryCreateRequest(null);
        setSelectNewCategoryOnCreate(false);
    }, []);

    useEffect(() => {
        if (!liaProductReview) {
            setLiaReviewRecord({ status: 'idle', product: null, contextToken: null, referenceId: null });
            return undefined;
        }

        const reference = liaProductReview.recordReference;
        const setCurrentReviewRecord = (status, product = null) => {
            setLiaReviewRecord({
                status,
                product,
                contextToken: currentLiaContextToken,
                referenceId: reference?.id ?? null
            });
        };
        if (!currentLiaContextToken || liaProductReview.contextToken !== currentLiaContextToken) {
            setCurrentReviewRecord('context_changed');
            return undefined;
        }
        if (!reference || !['product', 'batches'].includes(reference.kind)
            || !isSafeLiaRecordId(reference.id)) {
            setCurrentReviewRecord('invalid_reference');
            return undefined;
        }
        if (reference.kind === 'batches' && !canAccess('inventory')) {
            setCurrentReviewRecord('permission_denied');
            return undefined;
        }
        if (reference.kind === 'product' && !canAccess('products') && !canAccess('inventory')) {
            setCurrentReviewRecord('permission_denied');
            return undefined;
        }

        let active = true;
        setCurrentReviewRecord('loading');
        productRepository.getProductById(reference.id)
            .then((product) => {
                if (!active) return;
                const sameId = product && String(product.id) === reference.id;
                const deleted = product && (
                    product.deletedAt || product.deletedTimestamp || product.deleted_at || product.deleted_timestamp
                    || product.deletionPending === true
                );
                if (!sameId || deleted) {
                    setCurrentReviewRecord('unavailable');
                    return;
                }
                setCurrentReviewRecord('found', product);
                if (reference.kind === 'batches') setSelectedBatchProductId(reference.id);
            })
            .catch(() => {
                if (active) setCurrentReviewRecord('unavailable');
            });

        return () => { active = false; };
    }, [canAccess, currentLiaContextToken, liaProductReview]);

    const handleOpenCategoryManagerFromProduct = (onCategoryCreated) => {
        const requestId = Symbol('product-category-create');
        const request = {
            onCategoryCreated: (category) => {
                if (productCategoryCreateRequestRef.current !== requestId || !category?.id) return;
                onCategoryCreated?.(category);
            }
        };
        productCategoryCreateRequestRef.current = requestId;
        setProductCategoryCreateRequest(request);
        setSelectNewCategoryOnCreate(true);
        setShowCategoryModal(true);
    };

    const handleCloseCategoryManager = () => {
        invalidateProductCategoryCreateRequest();
        setShowCategoryModal(false);
    };

    const discardProductFormChanges = useCallback(() => {
        invalidateProductCategoryCreateRequest();
        clearProductFormDraft(productFormDraftScope);
        setProductFormDraftValues(null);
        setEditingProduct(null);
        setIsProductFormDirty(false);
    }, [invalidateProductCategoryCreateRequest, productFormDraftScope]);

    useEffect(() => {
        if (activeTab === 'add-product') return;
        invalidateProductCategoryCreateRequest();
        setShowCategoryModal(false);
    }, [activeTab, invalidateProductCategoryCreateRequest]);

    const isProductFormActive = activeTab === 'add-product';
    const { runWithoutBlocking } = useNavigationGuard({
        enabled: isProductFormActive && isProductFormDirty,
        title: '¿Salir del formulario?',
        message: PRODUCT_FORM_EXIT_MESSAGE,
        confirmButtonText: 'Sí, salir',
        cancelButtonText: 'Continuar editando',
        onDiscard: discardProductFormChanges
    });

    useEffect(() => {
        refreshData();
    }, [licenseKey, refreshData]);

    useEffect(() => {
        const productType = activeTab === 'ingredients'
            ? 'ingredient'
            : (activeTab === 'view-products' ? 'sellable' : null);
        if (productType && filters.productType !== productType) {
            setFilters({ productType });
        }
    }, [activeTab, filters.productType, setFilters]);

    useEffect(() => {
        if (!cloudProductImagesEnabled || !licenseKey || products.length === 0) return undefined;
        if (typeof navigator !== 'undefined' && navigator.onLine === false) return undefined;

        const sessionKey = getProductImageMigrationSessionKey(licenseKey);
        const alreadyCompleted = typeof sessionStorage !== 'undefined'
            && sessionStorage.getItem(sessionKey) === 'completed';
        const migrationState = legacyImageMigrationRef.current;

        if (alreadyCompleted || migrationState.running || migrationState.licenseKey === licenseKey) {
            return undefined;
        }

        legacyImageMigrationRef.current = { licenseKey, running: true };
        let cancelled = false;

        const runMigration = async () => {
            const summary = await migrateLegacyProductImages({
                licenseKey,
                cloudEnabled: cloudProductImagesEnabled,
                limit: 25,
                saveProduct: (payload, existingProduct) => productRepository.saveProduct(
                    payload,
                    { existingProduct }
                )
            });

            if (cancelled) return;

            if (summary.failed === 0 && !summary.hasMore && typeof sessionStorage !== 'undefined') {
                sessionStorage.setItem(sessionKey, 'completed');
            }

            if (summary.migrated > 0) {
                await refreshData();
            }

            if (summary.migrated > 0 || summary.missingLocalBlob > 0 || summary.failed > 0 || summary.hasMore) {
                const messages = [];
                if (summary.migrated > 0) {
                    messages.push(`Se publicaron automáticamente ${summary.migrated} imagen(es) antiguas en la tienda en línea.`);
                }
                if (summary.missingLocalBlob > 0) {
                    const sampleNames = summary.missingProductNames.slice(0, 3).join(', ');
                    messages.push(
                        `${summary.missingLocalBlob} imagen(es) ya no están guardadas en este dispositivo${sampleNames ? ` (${sampleNames})` : ''}. Edita esos productos y vuelve a seleccionar la fotografía.`
                    );
                }
                if (summary.failed > 0) {
                    messages.push(`${summary.failed} imagen(es) no pudieron migrarse y se reintentarán en una próxima sesión.`);
                }
                if (summary.hasMore) {
                    messages.push('Quedan más imágenes antiguas pendientes; se continuará automáticamente en una próxima sesión para respetar los límites de seguridad de Storage.');
                }

                showMessageModal(messages.join('\n\n'), null, {
                    type: summary.missingLocalBlob > 0 || summary.failed > 0 ? 'warning' : 'success'
                });
            }
        };

        runMigration()
            .catch((error) => {
                Logger.warn('[Products] Migración de imágenes antiguas no completada:', error);
            })
            .finally(() => {
                if (legacyImageMigrationRef.current.licenseKey === licenseKey) {
                    legacyImageMigrationRef.current.running = false;
                }
            });

        return () => {
            cancelled = true;
        };
    }, [cloudProductImagesEnabled, licenseKey, products.length, refreshData]);

    useEffect(() => {
        const currentTabParam = searchParams.get('tab');
        const paramToTabMap = {
            add: 'add-product',
            ingredients: 'ingredients',
            batches: 'batches',
            categories: 'categories',
            variants: 'variants-view',
            restaurant: 'restaurant',
            list: 'view-products'
        };

        const requestedTab = currentTabParam ? paramToTabMap[currentTabParam] : null;
        const tabPermissions = {
            'add-product': 'products',
            'view-products': null,
            batches: 'inventory',
            ingredients: 'products',
            'variants-view': 'inventory',
            categories: 'products',
            restaurant: 'products'
        };
        const requestedPermission = tabPermissions[requestedTab];
        const requestedAllowed = requestedTab === 'restaurant'
            ? hasRestaurantProductSettings && canAccess('products')
            : Boolean(requestedTab) && (!requestedPermission || canAccess(requestedPermission));

        if (requestedAllowed) {
            setActiveTab(requestedTab);
        } else if (canManageProducts || canManageInventory) {
            setActiveTab('view-products');
        } else {
            setActiveTab(null);
        }
    }, [searchParams, hasRestaurantProductSettings, canAccess, canManageProducts, canManageInventory]);

    const handleTabChange = (tabKey) => {
        if (tabKey === activeTab) return;

        const tabPermissions = {
            'add-product': 'products',
            'view-products': null,
            batches: 'inventory',
            ingredients: 'products',
            'variants-view': 'inventory',
            categories: 'products',
            restaurant: 'products'
        };
        const requiredPermission = tabPermissions[tabKey];
        if (requiredPermission && !canAccess(requiredPermission)) {
            showMessageModal(requiredPermission === 'inventory'
                ? 'No tienes permiso para gestionar inventario.'
                : 'No tienes permiso para gestionar productos.', null, { type: 'warning' });
            return;
        }
        if (tabKey !== 'add-product' && !isProductFormDirty) {
            invalidateProductCategoryCreateRequest();
        }

        const urlMap = {
            'add-product': 'add',
            'view-products': 'list',
            batches: 'batches',
            ingredients: 'ingredients',
            categories: 'categories',
            'variants-view': 'variants',
            restaurant: 'restaurant'
        };

        const paramValue = urlMap[tabKey];
        if (paramValue === 'list') setSearchParams({});
        else setSearchParams({ tab: paramValue });
    };
    const ingredientsOnly = products;

    const handleActionableError = (errorResult) => {
        const error = errorResult?.error || errorResult;
        const authority = classifyActorAuthorityError(error, actorAccess.runtimeSnapshot);
        if (authority?.kind === 'tenant_verification_pending') {
            const recoveryMessage = errorResult?.phase === 'actor_preflight'
                ? errorResult.message
                : authority.message;
            showMessageModal(recoveryMessage || authority.message, () => {}, {
                type: 'warning',
                extraButton: {
                    text: 'Reintentar verificación',
                    action: async () => {
                        const verified = await retryTenantVerification();
                        if (!verified) {
                            showMessageModal('La verificación sigue pendiente. Conservamos los cambios del formulario; vuelve a intentarlo cuando el contexto del negocio esté listo.', null, { type: 'warning' });
                        }
                    }
                }
            });
            return;
        }
        const message = error?.message || errorResult?.message || 'No se pudo completar la operación.';
        const details = error?.details || {};

        let modalOptions = {};
        if (details.actionable === 'SUGGEST_BACKUP') {
            modalOptions = {
                extraButton: {
                    text: 'Ir a Respaldar',
                    action: () => setShowDataTransfer(true)
                }
            };
        } else if (details.actionable === 'SUGGEST_RELOAD') {
            modalOptions = {
                confirmButtonText: 'Recargar Página',
                extraButton: null
            };
        }

        showMessageModal(message, details.actionable === 'SUGGEST_RELOAD' ? () => window.location.reload() : null, {
            type: 'error',
            ...modalOptions
        });
    };

    const handleProductFormDirtyChange = useCallback((isDirty, values) => {
        setIsProductFormDirty(isDirty);
        if (!productFormDraftScope) return;
        if (!isDirty) {
            clearProductFormDraft(productFormDraftScope);
            setProductFormDraftValues(null);
            return;
        }
        if (!values) return;
        saveProductFormDraft(productFormDraftScope, {
            activeTab: 'add-product',
            productToEdit: editingProduct,
            values
        });
        setProductFormDraftValues(values);
    }, [editingProduct, productFormDraftScope]);

    const handleSaveCategory = async (categoryData) => {
        const isEditing = Boolean(categoryData.id);
        let savedCategory;

        try {
            savedCategory = await productRepository.saveCategory(categoryData);
            if (savedCategory?.success === false) {
                const error = getCategorySaveError(savedCategory);
                if (error.code === 'VERSION_CONFLICT') {
                    try {
                        const refreshed = await refreshCategories();
                        if (refreshed === false) {
                            Logger.warn('La categoría cambió en Cloud, pero la lista local no pudo actualizarse.');
                            if (!error.message.includes('lista local')) {
                                error.message += ' La lista local no se actualizó; sincroniza las categorías antes de reabrirla.';
                            }
                        }
                    } catch (refreshError) {
                        Logger.warn('La categoría cambió en Cloud, pero la lista local no pudo actualizarse:', refreshError);
                        if (!error.message.includes('lista local')) {
                            error.message += ' La lista local no se actualizó; sincroniza las categorías antes de reabrirla.';
                        }
                    }
                }
                throw error;
            }
            if (!savedCategory || typeof savedCategory !== 'object') {
                throw new Error('No se recibió confirmación del guardado de la categoría. Intenta de nuevo.');
            }
            if (cloudProductImagesEnabled && savedCategory.success !== true) {
                throw new Error('La nube no confirmó el guardado de la categoría. Intenta de nuevo.');
            }
        } catch (caughtError) {
            const error = caughtError instanceof Error
                ? caughtError
                : Object.assign(
                    new Error(caughtError?.message || (typeof caughtError === 'string' ? caughtError : 'No se pudo guardar la categoría.')),
                    caughtError && typeof caughtError === 'object' ? caughtError : {}
                );
            if (error.name === 'DatabaseError') {
                handleActionableError({ error });
                error.categorySaveHandledByModal = true;
            }
            else {
                Logger.error('Error guardando categoría:', error);
            }
            throw error;
        }

        const saveStatus = savedCategory.pending
            ? 'pending'
            : (cloudProductImagesEnabled ? 'confirmed' : 'local');

        try {
            await refreshCategories();
            await refreshData();
        } catch (refreshError) {
            Logger.warn('La categoría se guardó, pero no se pudo actualizar el catálogo en pantalla:', refreshError);
        }

        try {
            broadcastDBChange({
                action: isEditing ? 'category-updated' : 'category-created',
                categoryId: savedCategory.id || categoryData.id,
                categoryName: savedCategory.name || categoryData.name,
                timestamp: Date.now()
            });
        } catch (notificationError) {
            Logger.warn('La categoría se guardó, pero no se pudo notificar el cambio del catálogo:', notificationError);
        }

        return { ...savedCategory, saveStatus };
    };

    const handleDeleteCategory = async (category, productCount = null) => {
        const categoryRecord = typeof category === 'object'
            ? category
            : categories.find((item) => item.id === category);
        const categoryId = categoryRecord?.id || category;
        const categoryName = categoryRecord?.name || 'esta categoría';
        const hasReliableCount = !cloudProductImagesEnabled && Number.isInteger(productCount) && productCount >= 0;
        const confirmationMessage = hasReliableCount
            ? productCount === 0
                ? 'No hay productos asociados. Los productos no se eliminarán.'
                : productCount === 1
                    ? 'El producto asociado quedará sin categoría. El producto no se eliminará.'
                    : `Los ${productCount} productos asociados quedarán sin categoría. Los productos no se eliminarán.`
            : 'Los productos asociados quedarán sin categoría. Los productos no se eliminarán.';

        if (!(await showConfirmModal(confirmationMessage, {
            title: `¿Eliminar «${categoryName}»?`,
            confirmButtonText: 'Eliminar categoría',
            cancelButtonText: 'Cancelar'
        }))) return;

        setIsLoading(true);
        try {
            const result = await productRepository.deleteCategory(categoryId);
            if (!result?.success) {
                handleActionableError(result);
                return;
            }

            if (filters.categoryId === categoryId) setFilters({ categoryId: null });
            await refreshCategories();
            await refreshData();

            broadcastDBChange({
                action: 'category-deleted',
                categoryId,
                cascade: { field: 'categoryId', setTo: '' },
                timestamp: Date.now()
            });

            showMessageModal(result.pending ? 'Categoría eliminada localmente. Se sincronizará al volver internet.' : '✅ Categoría eliminada.');
        } catch (error) {
            if (error.name === 'DatabaseError') handleActionableError({ error });
            else {
                Logger.error('Error eliminando categoría:', error);
                showMessageModal(`Error: ${error.message}`);
            }
        } finally {
            setIsLoading(false);
        }
    };

    const handleSaveProduct = async (productData, productToEdit, options = {}) => {
        setIsLoading(true);
        const presentSaveError = (result, fallbackCode = 'PRODUCT_SAVE_REJECTED') => {
            const code = getProductSaveErrorCode(result, fallbackCode);
            Logger.warn('[Products] Guardado de producto rechazado.', {
                stage: 'product_repository_result',
                code
            });
            return { success: false, errorPresented: true, code };
        };
        const presentUnknownSaveResult = (code = 'PRODUCT_SAVE_RESULT_MISSING') => {
            Logger.warn('[Products] Guardado sin confirmación de resultado.', {
                stage: 'product_repository_result',
                code
            });
            showMessageModal(
                `Cloud no confirmó el resultado del guardado. Conserva los cambios y verifica el catálogo antes de volver a guardar. Código: ${code}.`,
                null,
                { type: 'warning' }
            );
            return { success: false, errorPresented: true, outcome: 'unknown', code };
        };
        try {
            let imagePreparation;
            try {
                imagePreparation = await prepareProductImageForCloud({
                    productData,
                    existingProduct: productToEdit,
                    licenseKey,
                    cloudEnabled: cloudProductImagesEnabled
                });
            } catch (error) {
                const code = getProductSaveErrorCode(error, 'PRODUCT_IMAGE_PREPARATION_FAILED');
                Logger.warn('[Products] Preparación de imagen de producto fallida.', {
                    stage: 'image_preparation',
                    code
                });
                showMessageModal(
                    error?.message || 'No se pudo subir la imagen del producto. Revisa tu conexión e intenta nuevamente.'
                );
                return { success: false, errorPresented: true, code };
            }

            const productPayload = imagePreparation.productPayload;
            let result = await productRepository.saveProduct(productPayload, { existingProduct: productToEdit });
            if (!result || typeof result !== 'object') return presentUnknownSaveResult();

            if (result?.code === 'PRODUCT_CATEGORY_RECOVERY_REQUIRED') {
                const category = result.category || result.error?.category;
                const categoryId = category?.id || productPayload.categoryId || productPayload.category_id;
                const categoryName = category?.name || 'la categoría seleccionada';
                if (!categoryId) {
                    handleActionableError(result);
                    return presentSaveError(result, 'PRODUCT_CATEGORY_RECOVERY_REQUIRED');
                }

                const confirmRecovery = await showConfirmModal(
                    `«${categoryName}» solo existe en este dispositivo. Para guardar el producto, confirma esta categoría en la nube conservando su ID actual.`,
                    {
                        title: 'Confirmar categoría local',
                        confirmButtonText: 'Confirmar categoría en Nube',
                        cancelButtonText: 'Cancelar'
                    }
                );
                if (!confirmRecovery) {
                    return {
                        success: false,
                        cancelled: true,
                        code: 'PRODUCT_CATEGORY_RECOVERY_CANCELLED',
                        message: 'Guardado cancelado. Conservamos los cambios del formulario.'
                    };
                }

                const recovery = await productRepository.confirmLocalCategoryInCloud(categoryId);
                if (!recovery?.success || recovery.category?.id !== categoryId) {
                    handleActionableError(recovery?.success === false ? recovery : {
                        success: false,
                        message: 'Cloud no confirmó el ID original de la categoría. El producto no se guardó.'
                    });
                    return presentSaveError(recovery, 'PRODUCT_CATEGORY_CONFIRMATION_FAILED');
                }

                await refreshCategories();
                broadcastDBChange({
                    action: 'category-cloud-confirmed',
                    categoryId,
                    categoryName: recovery.category.name || categoryName,
                    timestamp: Date.now()
                });
                result = await productRepository.saveProduct(productPayload, { existingProduct: productToEdit });
                if (!result || typeof result !== 'object') return presentUnknownSaveResult();
            }

            const resultCode = getProductSaveErrorCode(result, '');
            if (PRODUCT_SAVE_RESULT_UNKNOWN_CODES.has(resultCode)) {
                return presentUnknownSaveResult(resultCode);
            }
            if (result?.success !== true && result?.success !== false && !result?.partial) {
                return presentUnknownSaveResult(resultCode || 'PRODUCT_SAVE_RESULT_INVALID');
            }

            if (result?.partial) {
                handleActionableError(result);
                Logger.warn('[Products] Guardado de producto parcialmente aplicado.', {
                    stage: 'product_repository_result',
                    code: getProductSaveErrorCode(result, 'PRODUCT_SAVE_PARTIAL')
                });
                return { ...result, errorPresented: true };
            }

            if (result?.success && result.localReconciliationPending) {
                clearProductFormDraft(productFormDraftScope);
                setProductFormDraftValues(null);
                setEditingProduct(null);
                setIsProductFormDirty(false);
                showMessageModal(result.message, () => {}, {
                    type: 'warning',
                    extraButton: {
                        text: 'Verificar y sincronizar catálogo',
                        action: async () => {
                            const refreshed = await retryTenantVerification({ refreshCatalog: true });
                            showMessageModal(
                                refreshed
                                    ? 'El catálogo se actualizó después de verificar la sesión.'
                                    : 'La verificación o actualización del catálogo sigue pendiente. No vuelvas a guardar este cambio.',
                                null,
                                { type: refreshed ? 'success' : 'warning' }
                            );
                        }
                    }
                });
                runWithoutBlocking(() => handleTabChange('view-products'));
                return {
                    success: true,
                    pending: true,
                    localReconciliationPending: true,
                    message: result.message,
                    messageHandled: true
                };
            }

            if (result?.success) {
                let refreshFailed = false;
                try {
                    if (await refreshData() === false) refreshFailed = true;
                } catch (refreshError) {
                    refreshFailed = true;
                    Logger.warn('[Products] El producto se guardó, pero la lista local no se actualizó:', refreshError);
                }
                try {
                    if (await refreshCategories() === false) refreshFailed = true;
                } catch (refreshError) {
                    refreshFailed = true;
                    Logger.warn('[Products] El producto se guardó, pero las categorías locales no se actualizaron:', refreshError);
                }

                const valueDifference = Number(result.inventoryValue || 0);
                if (valueDifference > 0) await adjustInventoryValue(valueDifference);

                let successMessage = result.pending
                    ? (result.message || 'Producto guardado localmente. Se sincronizará al volver internet.')
                    : (productToEdit ? '¡Actualizado exitosamente!' : '¡Producto creado exitosamente!');

                if (refreshFailed) {
                    successMessage += '\n\nEl producto sí quedó guardado, pero la lista no pudo actualizarse. Verifica la sesión y sincroniza el catálogo antes de volver a editarlo.';
                }

                if (imagePreparation.requiresReselection) {
                    successMessage += '\n\nLa fotografía anterior no está guardada en este dispositivo. Vuelve a seleccionarla para publicarla en la tienda en línea.';
                }

                const keepFormOpen = options.intent === 'save_and_add_another' || options.keepFormOpen;
                if (!keepFormOpen) {
                    showMessageModal(successMessage, null, {
                        type: imagePreparation.requiresReselection || refreshFailed ? 'warning' : 'success'
                    });
                }

                broadcastDBChange({
                    action: productToEdit ? 'product-updated' : 'product-created',
                    productId: result.productId || productPayload.id || productToEdit?.id,
                    timestamp: Date.now()
                });

                if (keepFormOpen) return { success: true, pending: result.pending, message: successMessage };

                clearProductFormDraft(productFormDraftScope);
                setProductFormDraftValues(null);
                setEditingProduct(null);
                setIsProductFormDirty(false);
                runWithoutBlocking(() => {
                    if (productPayload.productType === 'ingredient') handleTabChange('ingredients');
                    else handleTabChange('view-products');
                });

                return { success: true, messageHandled: true };
            }

            if (['DUPLICATE_BARCODE', 'DUPLICATE_PRODUCT_KEY'].includes(result?.code || result?.error?.code)) return result;
            handleActionableError(result);
            return presentSaveError(result);
        } catch (error) {
            const code = getProductSaveErrorCode(error, 'PRODUCT_SAVE_EXCEPTION');
            Logger.warn('[Products] Guardado de producto sin resultado confirmado.', {
                stage: 'product_repository_call',
                code
            });
            showMessageModal(
                `No pudimos confirmar el resultado del guardado. Conserva los cambios y verifica el catálogo antes de volver a guardar. Código: ${code}.`,
                null,
                { type: 'warning' }
            );
            return { success: false, errorPresented: true, outcome: 'unknown', code };
        } finally {
            setIsLoading(false);
        }
    };

    const handleOpenExistingFromBarcode = async (product) => {
        if (isProductFormDirty && !(await showConfirmModal(PRODUCT_FORM_EXIT_MESSAGE, {
            title: '¿Editar el producto existente?',
            confirmButtonText: 'Descartar cambios y editar',
            cancelButtonText: 'Seguir capturando'
        }))) return;
        invalidateProductCategoryCreateRequest();
        clearProductFormDraft(productFormDraftScope);
        setProductFormDraftValues(null);
        setIsProductFormDirty(false);
        setEditingProduct(product);
    };

    const handleEditProduct = (product) => {
        invalidateProductCategoryCreateRequest();
        clearProductFormDraft(productFormDraftScope);
        setProductFormDraftValues(null);
        setIsProductFormDirty(false);
        setEditingProduct(product);
        handleTabChange('add-product');
    };

    const handleCreateIngredient = () => {
        invalidateProductCategoryCreateRequest();
        clearProductFormDraft(productFormDraftScope);
        setProductFormDraftValues(null);
        setIsProductFormDirty(false);
        setEditingProduct({ name: '', productType: 'ingredient' });
        handleTabChange('add-product');
    };

    const handleCancelProductForm = async () => {
        if (isProductFormDirty && !(await showConfirmModal(PRODUCT_FORM_EXIT_MESSAGE, {
            title: '¿Salir del formulario?',
            confirmButtonText: 'Sí, salir',
            cancelButtonText: 'Continuar editando'
        }))) return;

        discardProductFormChanges();
        runWithoutBlocking(() => handleTabChange('view-products'));
    };

    const handleDeleteProduct = async (product) => {
        if (!(await showConfirmModal(`¿Eliminar "${product.name}"?`, {
            title: 'Eliminar producto',
            confirmButtonText: 'Si, eliminar',
            cancelButtonText: 'Cancelar'
        }))) return;

        setIsLoading(true);
        try {
            const result = await productRepository.deleteProduct(product);
            if (!result?.success) {
                handleActionableError(result);
                return;
            }

            await refreshData();
            broadcastDBChange({ action: 'product-deleted', productId: product.id, timestamp: Date.now() });
            showMessageModal(result.pending ? 'Producto eliminado localmente. Se sincronizará al volver internet.' : 'Producto eliminado.');
        } catch (error) {
            Logger.error(error);
            showMessageModal(error?.message || 'Error al eliminar el producto.');
        } finally {
            setIsLoading(false);
        }
    };

    const handleToggleStatus = async (product) => {
        setIsLoading(true);
        try {
            const result = await productRepository.toggleProductStatus(product);
            if (result?.success) {
                await refreshData();
                broadcastDBChange({
                    action: 'product-status-changed',
                    productId: product.id,
                    isActive: !(product.isActive !== false),
                    timestamp: Date.now()
                });
            } else {
                handleActionableError(result);
            }
        } catch (error) {
            Logger.error(error);
            showMessageModal(error?.message || 'Error al cambiar estado');
        } finally {
            setIsLoading(false);
        }
    };

    const handleManageBatches = (productId) => {
        setSelectedBatchProductId(productId);
        handleTabChange('batches');
    };

    const returnToLia = () => {
        const resumeSnapshot = liaProductReview?.resumeSnapshot;
        navigate(`/${ADMIN_ROUTE_PATHS.aiAgents}`, {
            state: resumeSnapshot ? { liaResumeSnapshot: resumeSnapshot } : null
        });
    };

    return (
        <>
            <main className="ui-page products-page" aria-label="Productos">

            {liaProductReview && <section className="lia-product-review" aria-labelledby="lia-product-review-title">
                <div className="lia-product-review__heading">
                    <div>
                        <p className="lia-product-review__eyebrow">Revisión desde Lía</p>
                        <h2 id="lia-product-review-title">
                            {currentLiaReviewRecord.status === 'found'
                                ? currentLiaReviewRecord.product.name
                                : liaProductReview.productName || 'Registro relacionado'}
                        </h2>
                    </div>
                    <button type="button" className="lia-product-review__back" onClick={returnToLia}>Volver al análisis</button>
                </div>
                {currentLiaReviewRecord.status === 'loading' && <p role="status">Abriendo el registro del negocio…</p>}
                {currentLiaReviewRecord.status === 'context_changed' && <p role="status">El negocio o la sesión cambió. No se consultó el registro anterior.</p>}
                {currentLiaReviewRecord.status === 'invalid_reference' && <p role="status">La referencia del producto no es válida. No se abrió ningún registro.</p>}
                {currentLiaReviewRecord.status === 'permission_denied' && <p role="status">Tu permiso actual no permite revisar este registro.</p>}
                {currentLiaReviewRecord.status === 'unavailable' && <p role="status">Este producto ya no está disponible o fue eliminado. No se abrió otro registro.</p>}
                {currentLiaReviewRecord.status === 'found' && currentLiaReviewRecord.product.isActive === false && (
                    <p role="status">Este producto está archivado. Se muestra su ficha actual para consulta.</p>
                )}
                {currentLiaReviewRecord.status === 'found' && liaProductReview.costReview === true && (
                    <p className="lia-product-review__cost-note" role="note">
                        {liaProductReview.recordReference.kind === 'batches'
                            ? 'Lía analizó el costo asociado a las ventas del periodo. Los costos de lotes disponibles hoy son referencias actuales y pueden ser distintos.'
                            : 'El costo registrado actualmente en Productos puede ser distinto del costo asociado a las ventas del periodo que analizó Lía.'}
                    </p>
                )}
            </section>}

            <section className="ui-section products-tabs-section" aria-label="Secciones de productos">
            <div className="tabs-container products-tabs" id="product-tabs">
                {canManageProducts && (
                    <button
                        className={`tab-btn ${activeTab === 'add-product' ? 'active' : ''}`}
                        onClick={() => {
                            if (activeTab === 'add-product') return;
                            invalidateProductCategoryCreateRequest();
                            setEditingProduct(null);
                            handleTabChange('add-product');
                        }}
                    >
                        {editingProduct && !editingProduct.id ? 'Nuevo Insumo' : (editingProduct ? 'Editar Item' : 'Agregar Producto')}
                    </button>
                )}

                <button
                    className={`tab-btn ${activeTab === 'view-products' ? 'active' : ''}`}
                    onClick={() => handleTabChange('view-products')}
                >
                    Productos (Venta)
                </button>

                {canManageInventory && (
                    <button
                        className={`tab-btn ${activeTab === 'batches' ? 'active' : ''}`}
                        onClick={() => handleTabChange('batches')}
                    >
                        Gestionar Lotes
                    </button>
                )}

                {canManageProducts && features.hasRecipes && (
                    <button
                        className={`tab-btn ${activeTab === 'ingredients' ? 'active' : ''}`}
                        onClick={() => handleTabChange('ingredients')}
                    >
                        Ingredientes/Insumos
                    </button>
                )}

                {canManageInventory && features.hasVariants && isApparel && (
                    <button
                        className={`tab-btn ${activeTab === 'variants-view' ? 'active' : ''}`}
                        onClick={() => handleTabChange('variants-view')}
                    >
                        Inventario Global (Tallas)
                    </button>
                )}

                {canManageProducts && (
                    <button
                        className={`tab-btn ${activeTab === 'categories' ? 'active' : ''}`}
                        onClick={() => handleTabChange('categories')}
                    >
                        Categorias
                    </button>
                )}

                {canManageProducts && hasRestaurantProductSettings && (
                    <button
                        className={`tab-btn ${activeTab === 'restaurant' ? 'active' : ''}`}
                        onClick={() => handleTabChange('restaurant')}
                    >
                        Restaurante
                    </button>
                )}
            </div>
            </section>

            <section className="ui-section products-workspace">
            {activeTab === 'add-product' && canManageProducts && (
                <ProductForm
                    key={`${productFormDraftScope || 'no-actor'}:${editingProduct?.id || 'new-product'}`}
                    onSave={handleSaveProduct}
                    onCancel={handleCancelProductForm}
                    onDirtyChange={handleProductFormDirtyChange}
                    onOpenExisting={handleOpenExistingFromBarcode}
                    productToEdit={editingProduct}
                    initialDraftValues={productFormDraftValues}
                    categories={categories}
                    onOpenCategoryManager={handleOpenCategoryManagerFromProduct}
                    onOpenBatches={(product) => handleManageBatches(product.id)}
                />
            )}

            {activeTab === 'view-products' && (!liaProductReview || isLiaProductReview) && (
                <ProductList
                    products={productsForSale}
                    categories={categories}
                    isLoading={isLoading}
                    onEdit={handleEditProduct}
                    onDelete={handleDeleteProduct}
                    onToggleStatus={handleToggleStatus}
                    onManageBatches={handleManageBatches}
                    onOpenDailyPrice={() => setShowDailyPrice(true)}
                    canManageProducts={canManageProducts}
                    canManageInventory={canManageInventory}
                    canDeleteProducts={canDeleteProducts}
                    reviewOnly={isLiaProductReview}
                    historicalCostReview={isLiaProductReview && liaProductReview.costReview === true}
                />
            )}

            {activeTab === 'ingredients' && canManageProducts && features.hasRecipes && (
                <IngredientManager
                    ingredients={ingredientsOnly}
                    onSave={handleSaveProduct}
                    onDelete={handleDeleteProduct}
                    onManageBatches={handleManageBatches}
                    onCreateIngredient={handleCreateIngredient}
                />
            )}

            {activeTab === 'categories' && canManageProducts && (
                <CategoryManager
                    categories={categories}
                    onSave={handleSaveCategory}
                    onRefresh={refreshCategories}
                    onDelete={handleDeleteCategory}
                />
            )}

            {activeTab === 'batches' && canManageInventory && (
                <BatchManager
                    selectedProductId={selectedBatchProductId}
                    canManageInventory={canManageInventory}
                    onProductSelect={setSelectedBatchProductId}
                />
            )}

            {activeTab === 'variants-view' && canManageInventory && features.hasVariants && isApparel && (
                <VariantInventoryView />
            )}

            {activeTab === 'restaurant' && canManageProducts && hasRestaurantProductSettings && (
                <PreparationStationsSettings />
            )}
            </section>
            </main>

            <CategoryManagerModal
                show={showCategoryModal && canManageProducts}
                onClose={handleCloseCategoryManager}
                categories={categories}
                onSave={handleSaveCategory}
                onRefresh={refreshCategories}
                onDelete={handleDeleteCategory}
                selectNewCategoryOnCreate={selectNewCategoryOnCreate}
                onCategoryCreated={productCategoryCreateRequest?.onCategoryCreated}
            />

            <DailyPriceModal
                show={showDailyPrice && canManageProducts}
                onClose={() => setShowDailyPrice(false)}
                products={products}
                onRefresh={() => refreshData()}
            />
        </>
    );
}
