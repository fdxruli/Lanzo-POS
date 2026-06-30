// src/pages/ProductsPage.jsx
import { useState, useEffect } from 'react';
import { showConfirmModal, showMessageModal } from '../services/utils';
import ProductForm from '../components/products/ProductForm';
import ProductList from '../components/products/ProductList';
import CategoryManagerModal from '../components/products/CategoryManagerModal';
import CategoryManager from '../components/products/CategoryManager';
import IngredientManager from '../components/products/IngredientManager';
import VariantInventoryView from '../components/products/VarianteInvetoryView';
import { useProductStore, broadcastDBChange } from '../store/useProductStore';
import { useStatsStore } from '../store/useStatsStore';
import BatchManager from '../components/products/BatchManager';
import { useFeatureConfig } from '../hooks/useFeatureConfig';
import DailyPriceModal from '../components/products/DailyPriceModal';
import { useAppStore } from '../store/useAppStore';
import { productRepository } from '../services/products/productRepository';
import './ProductsPage.css';
import Logger from '../services/Logger';
import { useSearchParams } from 'react-router-dom';
import { useNavigationGuard } from '../hooks/useNavigationGuard';

const PRODUCT_FORM_EXIT_MESSAGE = 'Estás editando o creando un producto. Si sales ahora, los datos no guardados se perderán. ¿Seguro que quieres salir?';

export default function ProductsPage() {
    const [showDailyPrice, setShowDailyPrice] = useState(false);
    const [activeTab, setActiveTab] = useState('view-products');
    const [searchParams, setSearchParams] = useSearchParams();
    const features = useFeatureConfig();
    const companyProfile = useAppStore(state => state.companyProfile);
    const isApparel = (() => {
        const types = companyProfile?.business_type;
        if (Array.isArray(types)) return types.includes('apparel');
        return types === 'apparel';
    })();

    const adjustInventoryValue = useStatsStore(state => state.adjustInventoryValue);
    const categories = useProductStore((state) => state.categories);
    const products = useProductStore((state) => state.menu);
    const filters = useProductStore((state) => state.filters);
    const setFilters = useProductStore((state) => state.setFilters);
    const refreshData = useProductStore((state) => state.loadInitialProducts);
    const refreshCategories = useProductStore((state) => state.refreshCategories);

    const [editingProduct, setEditingProduct] = useState(null);
    const [isLoading, setIsLoading] = useState(false);
    const [showCategoryModal, setShowCategoryModal] = useState(false);
    const [selectedBatchProductId, setSelectedBatchProductId] = useState(null);
    const [, setShowDataTransfer] = useState(false);

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
        setFilters({ categoryId: null, outOfStockOnly: false, expiredOnly: false });
        refreshData();
    }, [refreshData, setFilters]);

    useEffect(() => {
        const currentTabParam = searchParams.get('tab');
        const paramToTabMap = {
            add: 'add-product',
            ingredients: 'ingredients',
            batches: 'batches',
            categories: 'categories',
            variants: 'variants-view',
            list: 'view-products'
        };

        if (currentTabParam && paramToTabMap[currentTabParam]) {
            setActiveTab(paramToTabMap[currentTabParam]);
        } else {
            setActiveTab('view-products');
        }
    }, [searchParams]);

    const handleTabChange = (tabKey) => {
        if (tabKey === activeTab) return;

        const urlMap = {
            'add-product': 'add',
            'view-products': 'list',
            batches: 'batches',
            ingredients: 'ingredients',
            categories: 'categories',
            'variants-view': 'variants'
        };

        const paramValue = urlMap[tabKey];
        if (paramValue === 'list') setSearchParams({});
        else setSearchParams({ tab: paramValue });
    };

    const productsForSale = products.filter(p => p.productType === 'sellable' || !p.productType);
    const ingredientsOnly = products.filter(p => p.productType === 'ingredient');

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
            const result = await productRepository.saveProduct(productData, { existingProduct: productToEdit });

            if (result?.success) {
                await refreshData();
                await refreshCategories();

                const valueDifference = Number(result.inventoryValue || 0);
                if (valueDifference > 0) await adjustInventoryValue(valueDifference);

                showMessageModal(
                    result.pending
                        ? 'Producto guardado localmente. Se sincronizará al volver internet.'
                        : (productToEdit ? '¡Actualizado exitosamente!' : '¡Producto creado exitosamente!')
                );

                setEditingProduct(null);
                broadcastDBChange({
                    action: productToEdit ? 'product-updated' : 'product-created',
                    productId: result.productId || productData.id || productToEdit?.id,
                    timestamp: Date.now()
                });

                runWithoutBlocking(() => {
                    if (productData.productType === 'ingredient') handleTabChange('ingredients');
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
