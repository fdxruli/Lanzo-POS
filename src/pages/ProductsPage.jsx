// src/pages/ProductsPage.jsx
import React, { useState, useEffect } from 'react';
import { saveDataSafe, deleteDataSafe, saveBatchAndSyncProductSafe, loadData, saveData, deleteData, saveBulk, queryByIndex, STORES, deleteCategoryCascading, saveBatchAndSyncProduct, saveImageToDB } from '../services/database';
import { showMessageModal, generateID, fileToBase64 } from '../services/utils';
import ProductForm from '../components/products/ProductForm';
import ProductList from '../components/products/ProductList';
import CategoryManagerModal from '../components/products/CategoryManagerModal';
import CategoryManager from '../components/products/CategoryManager';
import IngredientManager from '../components/products/IngredientManager';
import VariantInventoryView from '../components/products/VarianteInvetoryView';

import { useProductStore } from '../store/useProductStore';
import { useStatsStore } from '../store/useStatsStore';

import BatchManager from '../components/products/BatchManager';
import { useFeatureConfig } from '../hooks/useFeatureConfig';
import DailyPriceModal from '../components/products/DailyPriceModal';
import { useAppStore } from '../store/useAppStore';
import ProductWizard from '../components/products/ProductWizard';
import './ProductsPage.css';
import Logger from '../services/Logger';
import { useSearchParams } from 'react-router-dom'

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

    // Corrección tipográfica: adjustInventoryValue
    const adjustInventoryValue = useStatsStore(state => state.adjustInventoryValue);

    // --- CONEXIÓN AL NUEVO STORE DE PRODUCTOS ---
    const categories = useProductStore((state) => state.categories);
    const products = useProductStore((state) => state.menu);

    const [editingProduct, setEditingProduct] = useState(null);
    const [isLoading, setIsLoading] = useState(false);
    const [showCategoryModal, setShowCategoryModal] = useState(false);
    const [selectedBatchProductId, setSelectedBatchProductId] = useState(null);
    const [isWizardMode, setIsWizardMode] = useState(true);
    const [, setShowDataTransfer] = useState(false);

    const setFilters = useProductStore((state) => state.setFilters);
    const refreshData = useProductStore((state) => state.loadInitialProducts);

    useEffect(() => {
        setFilters({ categoryId: null, outOfStockOnly: false })
        refreshData();
    }, []);

    useEffect(() => {
        const currentTabParam = searchParams.get('tab');

        const paramToTabMap = {
            'add': 'add-product',
            'ingredients': 'ingredients',
            'batches': 'batches',
            'categories': 'categories',
            'variants': 'variants-view',
            'list': 'view-products'
        };

        if (currentTabParam && paramToTabMap[currentTabParam]) {
            setActiveTab(paramToTabMap[currentTabParam]);
        } else {
            // Si no hay param o no coincide, volver a default
            setActiveTab('view-products');
        }
    }, [searchParams]);

    const handleTabChange = (tabKey) => {
        const urlMap = {
            'add-product': 'add',
            'view-products': 'list',
            'batches': 'batches',
            'ingredients': 'ingredients',
            'categories': 'categories',
            'variants-view': 'variants'
        };

        const paramValue = urlMap[tabKey];

        if (paramValue === 'list') {
            setSearchParams({});
        } else {
            setSearchParams({ tab: paramValue });
        }

        setActiveTab(tabKey);
    };

    // --- FILTROS PARA PESTAÑAS ---
    const productsForSale = products.filter(p => p.productType === 'sellable' || !p.productType);
    const ingredientsOnly = products.filter(p => p.productType === 'ingredient');

    const handleActionableError = (errorResult) => {
        const { message, details } = errorResult.error;

        // Configurar opciones del modal según la acción sugerida
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

        // Mostrar el modal con la configuración
        showMessageModal(message, details.actionable === 'SUGGEST_RELOAD' ? () => window.location.reload() : null, {
            type: 'error',
            ...modalOptions
        });
    };

    const handleSaveCategory = async (categoryData) => {
        // Usamos la versión segura
        const result = await saveDataSafe(STORES.CATEGORIES, categoryData);

        if (result.success) {
            await refreshData();
        } else {
            handleActionableError(result);
        }
    };

    const handleDeleteCategory = async (categoryId) => {
        if (!window.confirm('¿Eliminar esta categoría? Los productos asociados quedarán "Sin Categoría".')) {
            return;
        }

        setIsLoading(true);
        try {
            const catToDelete = categories.find(c => c.id === categoryId);
            if (catToDelete) {
                const deletedCat = { ...catToDelete, deletedTimestamp: new Date().toISOString() };
                // Usamos versión segura
                const res = await saveDataSafe(STORES.DELETED_CATEGORIES, deletedCat);
                if (!res.success) throw res.error; // Re-lanzar para el catch
            }

            await deleteCategoryCascading(categoryId);
            await refreshData();
            showMessageModal('✅ Categoría eliminada.');
        } catch (error) {
            // Si el error es de nuestro tipo DatabaseError
            if (error.name === 'DatabaseError') {
                handleActionableError({ error });
            } else {
                Logger.error("Error eliminando categoría:", error);
                showMessageModal(`Error: ${error.message}`);
            }
        } finally {
            setIsLoading(false);
        }
    };

    const handleSaveProduct = async (productData, editingProduct) => {
        setIsLoading(true);
        try {
            let finalImage = productData.image;

            // Lógica de imagen (se mantiene igual)
            if (productData.image instanceof File) {
                const imageId = `img-${Date.now()}`;
                await saveImageToDB(imageId, productData.image);
                finalImage = imageId;
            } else if (!productData.image && editingProduct?.image) {
                finalImage = editingProduct.image;
            }

            let valueDifference = 0;
            let result;

            // ID que usaremos (si es nuevo, usamos el que trae el wizard o generamos uno)
            const productId = editingProduct?.id || productData.id || generateID('prod');

            // --- 1. GUARDADO DEL PRODUCTO PADRE ---

            // Preparamos el objeto limpio para guardar en MENU (sin datos temporales del wizard)
            const baseProductData = {
                ...productData,
                id: productId,
                image: finalImage,
                updatedAt: new Date().toISOString()
            };

            // IMPORTANTE: Quitamos 'quickVariants' antes de guardar en la tabla MENU
            // porque eso no es un campo de la base de datos, es solo un transporte.
            delete baseProductData.quickVariants;

            if (editingProduct && editingProduct.id) {
                // Modo Edición
                const updatedProduct = { ...editingProduct, ...baseProductData };
                result = await saveDataSafe(STORES.MENU, updatedProduct);
            } else {
                // Modo Creación (Nuevo)
                const newProduct = {
                    ...baseProductData,
                    stock: 0, // El stock real se sumará al crear los lotes abajo
                    isActive: true,
                    createdAt: new Date().toISOString(),
                    batchManagement: { enabled: true, selectionStrategy: 'fifo' },
                };
                result = await saveDataSafe(STORES.MENU, newProduct);
            }

            // --- 2. PROCESAMIENTO DE STOCK Y VARIANTES (Aquí está la magia) ---

            if (result.success) {
                const initialCost = parseFloat(productData.cost) || 0;
                const initialPrice = parseFloat(productData.price) || 0;
                const initialStock = parseFloat(productData.stock) || 0;

                // Detectamos si vienen variantes del Wizard
                const hasVariants = productData.quickVariants && productData.quickVariants.length > 0;

                // Caso A: Producto Simple (Sin variantes, con stock inicial declarado)
                // Solo creamos lote simple si NO es receta y NO tiene variantes
                const isRecipeProduct = productData.productType === 'sellable' && productData.recipe?.length > 0;

                if (!isRecipeProduct && !hasVariants && initialStock > 0) {
                    const initialBatch = {
                        id: `batch-${productId}-initial`,
                        productId: productId,
                        cost: initialCost,
                        price: initialPrice,
                        stock: initialStock,
                        createdAt: new Date().toISOString(),
                        trackStock: true,
                        isActive: true,
                        notes: "Stock Inicial",
                        sku: null,
                        attributes: null
                    };
                    const batchRes = await saveBatchAndSyncProductSafe(initialBatch);
                    if (batchRes.success) valueDifference = initialCost * initialStock;
                }

                // Caso B: Variantes desde el Wizard (ROPA/CALZADO)  <-- ¡NUEVO CÓDIGO!
                if (hasVariants) {
                    for (const variant of productData.quickVariants) {
                        // Validamos que la variante tenga sentido (talla/color y stock o SKU)
                        if ((variant.talla || variant.color) && (parseFloat(variant.stock) > 0 || variant.sku)) {
                            const batchData = {
                                id: generateID('batch'),
                                productId: productId,
                                stock: parseFloat(variant.stock) || 0,
                                // Si la variante no tiene costo/precio específico, hereda del padre
                                cost: parseFloat(variant.cost) || initialCost,
                                price: parseFloat(variant.price) || initialPrice,
                                sku: variant.sku || null,
                                attributes: {
                                    talla: variant.talla || '',
                                    color: variant.color || ''
                                },
                                isActive: true,
                                createdAt: new Date().toISOString(),
                                notes: 'Ingreso rápido (Modo Asistido)',
                                trackStock: true
                            };

                            // Guardamos y sincronizamos cada variante
                            const vResult = await saveBatchAndSyncProductSafe(batchData);
                            if (vResult.success) {
                                valueDifference += (batchData.cost * batchData.stock);
                            }
                        }
                    }
                }
            }

            // --- 3. FINALIZACIÓN ---

            if (result.success) {
                await refreshData();
                if (valueDifference > 0) await adjustInventoryValue(valueDifference);

                showMessageModal(editingProduct ? '¡Actualizado exitosamente!' : '¡Producto creado exitosamente!');
                setEditingProduct(null);

                // Volvemos a la vista principal
                if (productData.productType === 'ingredient') setActiveTab('ingredients');
                else setActiveTab('view-products');

                return true;
            } else {
                handleActionableError(result);
                return false;
            }

        } catch (error) {
            Logger.error("Error crítico:", error);
            showMessageModal(`Error inesperado: ${error.message}`);
            return false;
        } finally {
            setIsLoading(false);
        }
    };

    const handleEditProduct = (product) => {
        setEditingProduct(product);
        setActiveTab('add-product');
    };

    const handleCreateIngredient = () => {
        setEditingProduct({
            name: '',
            productType: 'ingredient',
        });
        setActiveTab('add-product');
    };

    const handleDeleteProduct = async (product) => {
        if (window.confirm(`¿Eliminar "${product.name}"?`)) {
            try {
                product.deletedTimestamp = new Date().toISOString();

                // 1. Mover a papelera (Seguro)
                const resTrash = await saveDataSafe(STORES.DELETED_MENU, product);
                if (!resTrash.success) {
                    handleActionableError(resTrash);
                    return;
                }

                // 2. Borrar (Seguro)
                const resDel = await deleteDataSafe(STORES.MENU, product.id);
                if (!resDel.success) {
                    handleActionableError(resDel);
                    return;
                }

                // 3. Limpiar lotes (Lógica compleja, mantenemos genérica pero protegida)
                // (Para simplificar, asumimos que queryByIndex es seguro internamente con executeWithRetry)
                await refreshData();
                showMessageModal('Producto eliminado.');

            } catch (error) {
                Logger.error(error);
                showMessageModal("Error al eliminar el producto.");
            }
        }
    };

    const handleToggleStatus = async (product) => {
        setIsLoading(true);
        try {
            const updatedProduct = {
                ...product,
                isActive: !(product.isActive !== false),
                updatedAt: new Date().toISOString()
            };

            // GUARDADO SEGURO
            const result = await saveDataSafe(STORES.MENU, updatedProduct);

            if (result.success) {
                await refreshData();
            } else {
                handleActionableError(result);
            }
        } catch (error) {
            showMessageModal("Error al cambiar estado");
        } finally {
            setIsLoading(false);
        }
    };

    const handleManageBatches = (productId) => {
        setSelectedBatchProductId(productId);
        setActiveTab('batches');
    };

    return (
        <>
            <div className="products-header">
                <div style={{ display: 'flex', gap: '10px', flexDirection: 'column', width: '100%' }}>
                    {/* BOTÓN NUEVO PARA FRUTERÍA */}
                    {features.hasDailyPricing && (
                        <button
                            className="btn btn-primary btn-action-header"
                            style={{ backgroundColor: '#f97316' }}
                            onClick={() => setShowDailyPrice(true)}
                        >
                            📝 Actualizar Precios del Día
                        </button>
                    )}
                </div>

            </div >

            <div className="tabs-container" id="product-tabs" style={{ overflowX: 'auto' }}>
                <button
                    className={`tab-btn ${activeTab === 'add-product' ? 'active' : ''}`}
                    onClick={() => { setEditingProduct(null); handleTabChange('add-product'); }}
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

            {/* CONTENIDO DE PESTAÑAS */}

            {
                activeTab === 'add-product' && (
                    <>
                        {/* Toggle para cambiar entre modos (solo si es nuevo producto) */}
                        {!editingProduct && (
                            <div className="mode-selection-container">

                                {/* Opción 1: Modo Asistido */}
                                <label className={`mode-card ${isWizardMode ? 'selected' : ''}`}>
                                    <input
                                        type="radio"
                                        name="product-mode" // Importante: mismo name para agruparlos
                                        checked={isWizardMode}
                                        onChange={() => setIsWizardMode(true)}
                                        className="mode-radio"
                                    />
                                    <div className="mode-icon">✨</div>
                                    <div className="mode-content">
                                        <div className="mode-title">Modo Asistido</div>
                                        <div className="mode-description">Guía paso a paso para principiantes.</div>
                                    </div>
                                    <div className="mode-check-indicator"></div>
                                </label>

                                {/* Opción 2: Modo Experto */}
                                <label className={`mode-card ${!isWizardMode ? 'selected' : ''}`}>
                                    <input
                                        type="radio"
                                        name="product-mode"
                                        checked={!isWizardMode}
                                        onChange={() => setIsWizardMode(false)}
                                        className="mode-radio"
                                    />
                                    <div className="mode-icon">🛠️</div>
                                    <div className="mode-content">
                                        <div className="mode-title">Modo Experto</div>
                                        <div className="mode-description">Control total de inventario y opciones.</div>
                                    </div>
                                    <div className="mode-check-indicator"></div>
                                </label>
                            </div>
                        )}

                        {isWizardMode && !editingProduct ? (
                            <ProductWizard
                                onSave={handleSaveProduct}
                                onCancel={() => setActiveTab('view-products')}
                                categories={categories}
                            />
                        ) : (
                            <ProductForm
                                onSave={handleSaveProduct}
                                onCancel={() => setActiveTab('view-products')}
                                productToEdit={editingProduct}
                                categories={categories}
                                onOpenCategoryManager={() => setShowCategoryModal(true)}
                            // ... props existentes ...
                            />
                        )}
                    </>
                )
            }

            {
                activeTab === 'view-products' && (
                    <ProductList
                        products={productsForSale}
                        categories={categories}
                        isLoading={isLoading}
                        onEdit={handleEditProduct}
                        onDelete={handleDeleteProduct}
                        onToggleStatus={handleToggleStatus}
                        onManageBatches={handleManageBatches}
                    />
                )
            }

            {
                activeTab === 'ingredients' && features.hasRecipes && (
                    <IngredientManager
                        ingredients={ingredientsOnly}
                        onSave={handleSaveProduct}
                        onDelete={handleDeleteProduct}
                        onManageBatches={handleManageBatches}
                    />
                )
            }

            {
                activeTab === 'categories' && (
                    <CategoryManager
                        categories={categories}
                        onRefresh={refreshData}
                        onDelete={handleDeleteCategory}
                    />
                )
            }

            {
                activeTab === 'batches' && (
                    <BatchManager
                        selectedProductId={selectedBatchProductId}
                        onProductSelect={setSelectedBatchProductId}
                    />
                )
            }

            {activeTab === 'variants-view' && features.hasVariants && isApparel && (
                <VariantInventoryView />
            )}

            <CategoryManagerModal
                show={showCategoryModal}
                onClose={() => setShowCategoryModal(false)}
                categories={categories}
                // Usamos refreshData porque es la función que sincroniza 
                // el store con la base de datos tras un cambio
                onRefresh={refreshData}
                // Usamos handleDeleteCategory que ya tiene la lógica de 
                // borrado en cascada y manejo de errores
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
