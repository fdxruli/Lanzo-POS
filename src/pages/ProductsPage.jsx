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
import DataTransferModal from '../components/products/DataTransferModal';
import { useFeatureConfig } from '../hooks/useFeatureConfig';
import DailyPriceModal from '../components/products/DailyPriceModal';
import { useAppStore } from '../store/useAppStore';
import ProductWizard from '../components/products/ProductWizard';
import './ProductsPage.css';

export default function ProductsPage() {
    const [showDailyPrice, setShowDailyPrice] = useState(false);
    const [activeTab, setActiveTab] = useState('view-products');

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
    const rawProducts = useProductStore((state) => state.rawProducts);

    // Alias para mantener la compatibilidad con el resto del código
    const refreshData = useProductStore((state) => state.loadInitialProducts);

    const [editingProduct, setEditingProduct] = useState(null);
    const [isLoading, setIsLoading] = useState(false);
    const [showCategoryModal, setShowCategoryModal] = useState(false);
    const [showDataTransfer, setShowDataTransfer] = useState(false);
    const [selectedBatchProductId, setSelectedBatchProductId] = useState(null);
    const [isWizardMode, setIsWizardMode] = useState(true);

    // Carga inicial
    useEffect(() => {
        refreshData();
    }, []);

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
                console.error("Error eliminando categoría:", error);
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
            console.error("Error crítico:", error);
            showMessageModal(`Error inesperado: ${error.message}`);
            return false;
        } finally {
            setIsLoading(false);
        }
    };

    const handleEditProduct = (product) => {
        // Buscamos en rawProducts para tener la versión original sin agregaciones
        const productToEdit = rawProducts.find(p => p.id === product.id);
        if (productToEdit) {
            setEditingProduct(productToEdit);
            setActiveTab('add-product');
        }
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
                console.error(error);
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

                    <button
                        className="btn btn-secondary btn-action-header"
                        onClick={() => setShowDataTransfer(true)}
                    >
                        📥 / 📤 Importar y Exportar
                    </button>
                </div>

            </div >

            <div className="tabs-container" id="product-tabs" style={{ overflowX: 'auto' }}>
                <button
                    className={`tab-btn ${activeTab === 'add-product' ? 'active' : ''}`}
                    onClick={() => { setEditingProduct(null); setActiveTab('add-product'); }}
                >
                    {editingProduct && !editingProduct.id ? 'Nuevo Insumo' : (editingProduct ? 'Editar Item' : 'Añadir Producto')}
                </button>

                <button
                    className={`tab-btn ${activeTab === 'view-products' ? 'active' : ''}`}
                    onClick={() => setActiveTab('view-products')}
                >
                    Productos (Venta)
                </button>

                <button
                    className={`tab-btn ${activeTab === 'batches' ? 'active' : ''}`}
                    onClick={() => setActiveTab('batches')}
                >
                    Gestionar Lotes
                </button>

                {features.hasRecipes && (
                    <button
                        className={`tab-btn ${activeTab === 'ingredients' ? 'active' : ''}`}
                        onClick={() => setActiveTab('ingredients')}
                    >
                        Ingredientes/Insumos
                    </button>
                )}

                {features.hasVariants && isApparel && (
                    <button
                        className={`tab-btn ${activeTab === 'variants-view' ? 'active' : ''}`}
                        onClick={() => setActiveTab('variants-view')}
                    >
                        Inventario Global (Tallas)
                    </button>
                )}

                <button
                    className={`tab-btn ${activeTab === 'categories' ? 'active' : ''}`}
                    onClick={() => setActiveTab('categories')}
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
                            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '20px' }}>
                                <div className="theme-toggle-container">
                                    <label className="theme-radio-label">
                                        <input type="radio" checked={isWizardMode} onChange={() => setIsWizardMode(true)} />
                                        <span className="theme-radio-text">✨ Modo Asistido (Fácil)</span>
                                    </label>
                                    <label className="theme-radio-label">
                                        <input type="radio" checked={!isWizardMode} onChange={() => setIsWizardMode(false)} />
                                        <span className="theme-radio-text">🛠️ Modo Experto</span>
                                    </label>
                                </div>
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
                    />
                )
            }

            {
                activeTab === 'ingredients' && features.hasRecipes && (
                    <IngredientManager
                        ingredients={ingredientsOnly}
                        onSave={handleSaveProduct}
                        onDelete={handleDeleteProduct}
                    />
                )
            }

            {
                activeTab === 'categories' && (
                    <CategoryManager
                        categories={categories}
                        onSave={handleSaveCategory}
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
                onSave={handleSaveCategory}
                onDelete={handleDeleteCategory}
            />

            <DataTransferModal
                show={showDataTransfer}
                onClose={() => setShowDataTransfer(false)}
                onRefresh={refreshData}
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