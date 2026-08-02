// src/pages/ProductsPage.jsx
import { useState, useEffect, useMemo, useRef } from 'react';
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
import { useSearchParams } from 'react-router-dom';
import { useNavigationGuard } from '../hooks/useNavigationGuard';

const PRODUCT_FORM_EXIT_MESSAGE = 'Estás editando o creando un producto. Si sales ahora, los datos no guardados se perderán. ¿Seguro que quieres salir?';
const PRODUCT_IMAGE_MIGRATION_SESSION_PREFIX = 'lanzo:product-image-migration:';
const getProductImageMigrationSessionKey = (value) => {
    let hash = 2166136261;
    const input = String(value || '');
    for (let index = 0; index < input.length; index += 1) {
        hash ^= input.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return `${PRODUCT_IMAGE_MIGRATION_SESSION_PREFIX}${(hash >>> 0).toString(36)}`;
};

export default function ProductsPage() {
    const [showDailyPrice, setShowDailyPrice] = useState(false);
    const [activeTab, setActiveTab] = useState('view-products');
    const [searchParams, setSearchParams] = useSearchParams();
    const features = useFeatureConfig();
    const companyProfile = useAppStore(state => state.companyProfile);
    const licenseDetails = useAppStore(state => state.licenseDetails);
    const licenseKey = getLicenseKeyFromDetails(licenseDetails);
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

    const [editingProduct, setEditingProduct] = useState(null);
    const [isLoading, setIsLoading] = useState(false);
    const [showCategoryModal, setShowCategoryModal] = useState(false);
    const [selectedBatchProductId, setSelectedBatchProductId] = useState(null);
    const [, setShowDataTransfer] = useState(false);
    const legacyImageMigrationRef = useRef({ licenseKey: null, running: false });

    const isProductFormActive = activeTab === 'add-product';
    const { runWithoutBlocking } = useNavigationGuard({
        enabled: isProductFormActive,
        title: '¿Salir del formulario?',
        message: PRODUCT_FORM_EXIT_MESSAGE,
        confirmButtonText: 'Sí, salir',
        cancelButtonText: 'Continuar editando',
        onDiscard: () => setEditingProduct(null)
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

        if (currentTabParam && paramToTabMap[currentTabParam]) {
            if (paramToTabMap[currentTabParam] === 'restaurant' && !hasRestaurantProductSettings) {
                setActiveTab('view-products');
                return;
            }
            setActiveTab(paramToTabMap[currentTabParam]);
        } else {
            setActiveTab('view-products');
        }
    }, [searchParams, hasRestaurantProductSettings]);

    const handleTabChange = (tabKey) => {
        if (tabKey === activeTab) return;

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

    const productsForSale = products;
    const ingredientsOnly = products;

    const handleActionableError = (errorResult) => {
        const error = errorResult?.error || errorResult;
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

    const handleSaveCategory = async (categoryData) => {
        try {
            const isEditing = Boolean(categoryData.id);
            const savedCategory = await productRepository.saveCategory(categoryData);
            await refreshCategories();
            await refreshData();

            broadcastDBChange({
                action: isEditing ? 'category-updated' : 'category-created',
                categoryId: savedCategory?.id || categoryData.id,
                categoryName: savedCategory?.name || categoryData.name,
                timestamp: Date.now()
            });

            return savedCategory;
        } catch (error) {
            if (error.name === 'DatabaseError') handleActionableError({ error });
            else {
                Logger.error('Error guardando categoría:', error);
                showMessageModal(`Error: ${error.message}`);
            }
            throw error;
        }
    };

    const handleDeleteCategory = async (categoryId) => {
        if (!(await showConfirmModal('¿Eliminar esta categoría? Los productos asociados quedarán "Sin Categoría".', {
            title: 'Eliminar categoría',
            confirmButtonText: 'Si, eliminar',
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

    const handleSaveProduct = async (productData, productToEdit) => {
        setIsLoading(true);
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
                Logger.error('Error subiendo imagen pública del producto:', error);
                showMessageModal(
                    error?.message || 'No se pudo subir la imagen del producto. Revisa tu conexión e intenta nuevamente.'
                );
                return false;
            }

            const productPayload = imagePreparation.productPayload;
            const result = await productRepository.saveProduct(productPayload, { existingProduct: productToEdit });

            if (result?.success) {
                await refreshData();
                await refreshCategories();

                const valueDifference = Number(result.inventoryValue || 0);
                if (valueDifference > 0) await adjustInventoryValue(valueDifference);

                let successMessage = result.pending
                    ? 'Producto guardado localmente. Se sincronizará al volver internet.'
                    : (productToEdit ? '¡Actualizado exitosamente!' : '¡Producto creado exitosamente!');

                if (imagePreparation.requiresReselection) {
                    successMessage += '\n\nLa fotografía anterior no está guardada en este dispositivo. Vuelve a seleccionarla para publicarla en la tienda en línea.';
                }

                showMessageModal(successMessage, null, {
                    type: imagePreparation.requiresReselection ? 'warning' : 'success'
                });

                setEditingProduct(null);
                broadcastDBChange({
                    action: productToEdit ? 'product-updated' : 'product-created',
                    productId: result.productId || productPayload.id || productToEdit?.id,
                    timestamp: Date.now()
                });

                runWithoutBlocking(() => {
                    if (productPayload.productType === 'ingredient') handleTabChange('ingredients');
                    else handleTabChange('view-products');
                });

                return true;
            }

            handleActionableError(result);
            return false;
        } catch (error) {
            Logger.error('Error crítico guardando producto:', error);
            showMessageModal(`Error inesperado: ${error.message}`);
            return false;
        } finally {
            setIsLoading(false);
        }
    };

    const handleEditProduct = (product) => {
        setEditingProduct(product);
        handleTabChange('add-product');
    };

    const handleCreateIngredient = () => {
        setEditingProduct({ name: '', productType: 'ingredient' });
        handleTabChange('add-product');
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

    return (
        <>
            <main className="ui-page products-page" aria-label="Productos">
            <div className="products-header products-header--legacy" hidden>
                <div className="products-header__legacy-slot">
                    {/* El botón de Frutería fue movido a ProductList */}
                </div>
            </div >

            <section className="ui-section products-tabs-section" aria-label="Secciones de productos">
            <div className="tabs-container products-tabs" id="product-tabs">
                <button
                    className={`tab-btn ${activeTab === 'add-product' ? 'active' : ''}`}
                    onClick={() => {
                        if (activeTab === 'add-product') return;
                        setEditingProduct(null);
                        handleTabChange('add-product');
                    }}
                >
                    {editingProduct && !editingProduct.id ? 'Nuevo Insumo' : (editingProduct ? 'Editar Item' : 'Añadir Producto')}
                </button>

                <button
                    className={`tab-btn ${activeTab === 'view-products' ? 'active' : ''}`}
                    onClick={() => handleTabChange('view-products')}
                >
                    Productos (Venta)
                </button>

                <button
                    className={`tab-btn ${activeTab === 'batches' ? 'active' : ''}`}
                    onClick={() => handleTabChange('batches')}
                >
                    Gestionar Lotes
                </button>

                {features.hasRecipes && (
                    <button
                        className={`tab-btn ${activeTab === 'ingredients' ? 'active' : ''}`}
                        onClick={() => handleTabChange('ingredients')}
                    >
                        Ingredientes/Insumos
                    </button>
                )}

                {features.hasVariants && isApparel && (
                    <button
                        className={`tab-btn ${activeTab === 'variants-view' ? 'active' : ''}`}
                        onClick={() => handleTabChange('variants-view')}
                    >
                        Inventario Global (Tallas)
                    </button>
                )}

                <button
                    className={`tab-btn ${activeTab === 'categories' ? 'active' : ''}`}
                    onClick={() => handleTabChange('categories')}
                >
                    Categorías
                </button>

                {hasRestaurantProductSettings && (
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
            {activeTab === 'add-product' && (
                <ProductForm
                    onSave={handleSaveProduct}
                    onCancel={() => handleTabChange('view-products')}
                    productToEdit={editingProduct}
                    categories={categories}
                    onOpenCategoryManager={() => setShowCategoryModal(true)}
                />
            )}

            {activeTab === 'view-products' && (
                <ProductList
                    products={productsForSale}
                    categories={categories}
                    isLoading={isLoading}
                    onEdit={handleEditProduct}
                    onDelete={handleDeleteProduct}
                    onToggleStatus={handleToggleStatus}
                    onManageBatches={handleManageBatches}
                    onOpenDailyPrice={() => setShowDailyPrice(true)}
                />
            )}

            {activeTab === 'ingredients' && features.hasRecipes && (
                <IngredientManager
                    ingredients={ingredientsOnly}
                    onSave={handleSaveProduct}
                    onDelete={handleDeleteProduct}
                    onManageBatches={handleManageBatches}
                    onCreateIngredient={handleCreateIngredient}
                />
            )}

            {activeTab === 'categories' && (
                <CategoryManager
                    categories={categories}
                    onSave={handleSaveCategory}
                    onRefresh={refreshCategories}
                    onDelete={handleDeleteCategory}
                />
            )}

            {activeTab === 'batches' && (
                <BatchManager
                    selectedProductId={selectedBatchProductId}
                    onProductSelect={setSelectedBatchProductId}
                />
            )}

            {activeTab === 'variants-view' && features.hasVariants && isApparel && (
                <VariantInventoryView />
            )}

            {activeTab === 'restaurant' && hasRestaurantProductSettings && (
                <PreparationStationsSettings />
            )}
            </section>
            </main>

            <CategoryManagerModal
                show={showCategoryModal}
                onClose={() => setShowCategoryModal(false)}
                categories={categories}
                onSave={handleSaveCategory}
                onRefresh={refreshCategories}
                onDelete={handleDeleteCategory}
            />

            <DailyPriceModal
                show={showDailyPrice}
                onClose={() => setShowDailyPrice(false)}
                products={products}
                onRefresh={() => refreshData()}
            />
        </>
    );
}
