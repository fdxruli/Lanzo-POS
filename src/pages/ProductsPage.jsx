// src/pages/ProductsPage.jsx
import React, { useState, useEffect } from 'react';
import { loadData, saveData, deleteData, saveBulk, queryByIndex,STORES, deleteCategoryCascading } from '../services/database';
import { showMessageModal } from '../services/utils';
import ProductForm from '../components/products/ProductForm';
import ProductList from '../components/products/ProductList';
import CategoryManagerModal from '../components/products/CategoryManagerModal';
import CategoryManager from '../components/products/CategoryManager';
import IngredientManager from '../components/products/IngredientManager';
import { uploadFile } from '../services/supabase';
// --- CAMBIO: Usamos el store especializado ---
import { useProductStore } from '../store/useProductStore';
import { useStatsStore } from '../store/useStatsStore';

import BatchManager from '../components/products/BatchManager';
import DataTransferModal from '../components/products/DataTransferModal';
import { useFeatureConfig } from '../hooks/useFeatureConfig';
import DailyPriceModal from '../components/products/DailyPriceModal';
import './ProductsPage.css';

export default function ProductsPage() {
    const [showDailyPrice, setShowDailyPrice] = useState(false);
    const [activeTab, setActiveTab] = useState('view-products');

    const features = useFeatureConfig();

    const adjuntInventoryValue = useStatsStore(state => state.adjuntInventoryValue);

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

    // Carga inicial
    useEffect(() => {
        refreshData();
    }, []);

    // --- FILTROS PARA PESTAÑAS ---
    const productsForSale = products.filter(p => p.productType === 'sellable' || !p.productType);
    const ingredientsOnly = products.filter(p => p.productType === 'ingredient');

    const handleSaveCategory = async (categoryData) => {
        try {
            await saveData(STORES.CATEGORIES, categoryData);
            await refreshData(); // Recargar categorías en el store
        } catch (error) {
            console.error("Error guardando categoría:", error);
        }
    };

    const handleDeleteCategory = async (categoryId) => {
        if (!window.confirm('¿Eliminar esta categoría? Los productos asociados quedarán "Sin Categoría".')) {
            return;
        }

        try {
            setIsLoading(true);

            const catToDelete = categories.find(c => c.id === categoryId);
            if (catToDelete) {
                const deletedCat = {
                    ...catToDelete,
                    deletedTimestamp: new Date().toISOString()
                };
                await saveData(STORES.DELETED_CATEGORIES, deletedCat);
            }

            // Usamos la transacción atómica para limpiar referencias
            await deleteCategoryCascading(categoryId);

            // Recargamos datos para reflejar cambios
            await refreshData();

            showMessageModal('✅ Categoría eliminada y productos actualizados correctamente.');
        } catch (error) {
            console.error("Error eliminando categoría:", error);
            showMessageModal(`Error de base de datos: ${error.message}`);
        } finally {
            setIsLoading(false);
        }
    };

    const handleSaveProduct = async (productData, editingProduct) => {
        setIsLoading(true);
        try {
            let finalImage = productData.image;
            if (productData.image && productData.image instanceof File) {
                finalImage = await uploadFile(productData.image, 'product');
                if (!finalImage) finalImage = null;
            }

            let valueDifference = 0; // Para ajustar el valor del inventario

            if (editingProduct && editingProduct.id) {
                // ... (Lógica de edición existente) ...
                const updatedProduct = {
                    ...editingProduct,
                    ...productData,
                    image: finalImage || editingProduct.image,
                    updatedAt: new Date().toISOString()
                };
                await saveData(STORES.MENU, updatedProduct);
                showMessageModal('¡Actualizado exitosamente!');

            } else {
                // CREACIÓN DE NUEVO PRODUCTO
                const newId = `product-${Date.now()}`;
                const newProduct = {
                    id: newId,
                    ...productData,
                    image: finalImage,
                    isActive: true,
                    createdAt: new Date().toISOString(),
                    batchManagement: { enabled: true, selectionStrategy: 'fifo' },
                };

                await saveData(STORES.MENU, newProduct);

                const initialCost = productData.cost ? parseFloat(productData.cost) : 0;
                const initialStock = productData.stock ? parseFloat(productData.stock) : 0;

                const isRecipeProduct = productData.productType === 'sellable' && productData.recipe?.length > 0;

                // Si tiene stock inicial y costo, calculamos el valor para sumarlo al Dashboard
                if (!isRecipeProduct && initialStock > 0) {
                    const initialBatch = {
                        id: `batch-${newId}-initial`,
                        productId: newId,
                        cost: initialCost,
                        price: parseFloat(productData.price) || 0,
                        stock: initialStock,
                        createdAt: new Date().toISOString(),
                        trackStock: true,
                        isActive: initialStock > 0,
                        notes: "Stock Inicial (Registro Rápido)",
                        sku: null, attributes: null
                    };
                    await saveData(STORES.PRODUCT_BATCHES, initialBatch);
                    
                    // --- CORRECCIÓN CLAVE: Sumar al valor del inventario ---
                    valueDifference = initialCost * initialStock;
                }

                if (productData.productType === 'ingredient' && initialStock > 0) {
                    showMessageModal(`¡Insumo creado con ${initialStock} unidades!`);
                } else {
                    showMessageModal('¡Producto creado exitosamente!');
                }
            }

            // Actualizamos la vista de productos
            await refreshData();
            
            // Actualizamos el Dashboard (Store de estadísticas)
            if (valueDifference > 0) {
                await adjustInventoryValue(valueDifference);
            }

            setEditingProduct(null);

            if (productData.productType === 'ingredient') {
                setActiveTab('ingredients');
            } else {
                setActiveTab('view-products');
            }

        } catch (error) {
            console.error("Error:", error);
            showMessageModal(`Error: ${error.message}`);
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
                await saveData(STORES.DELETED_MENU, product);
                await deleteData(STORES.MENU, product.id);

                // --- CAMBIO: Buscar lotes en BD en lugar de memoria ---
                const productBatches = await queryByIndex(STORES.PRODUCT_BATCHES, 'productId', product.id);
                
                if (productBatches.length > 0) {
                    const updatedBatches = productBatches.map(b => ({ 
                        ...b, 
                        isActive: false, 
                        stock: 0, 
                        notes: b.notes + ' [Eliminado]' 
                    }));
                    await saveBulk(STORES.PRODUCT_BATCHES, updatedBatches);
                }
                
                await refreshData();
            } catch (error) {
                console.error(error);
                showMessageModal("Error al eliminar el producto.");
            }
        }
    };

    const handleToggleStatus = async (product) => {
        setIsLoading(true);
        try {
            const currentStatus = product.isActive !== false;

            const updatedProduct = {
                ...product,
                isActive: !currentStatus,
                updatedAt: new Date().toISOString()
            };

            await saveData(STORES.MENU, updatedProduct);
            await refreshData();

        } catch (error) {
            console.error(error);
            showMessageModal("Error al cambiar el estado del producto");
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
                    <ProductForm
                        onSave={handleSaveProduct}
                        onCancel={() => setActiveTab('view-products')}
                        productToEdit={editingProduct}
                        categories={categories}
                        onOpenCategoryManager={() => setShowCategoryModal(true)}
                        products={products}
                        onEdit={handleEditProduct}
                        onManageBatches={handleManageBatches}
                    />
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