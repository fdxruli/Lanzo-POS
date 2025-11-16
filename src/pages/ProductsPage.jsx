// src/pages/ProductsPage.jsx
import React, { useState, useEffect, useCallback } from 'react';
import { loadData, saveData, deleteData, STORES } from '../services/database';
import { showMessageModal } from '../services/utils';
import ProductForm from '../components/products/ProductForm';
import ProductList from '../components/products/ProductList';
import CategoryManagerModal from '../components/products/CategoryManagerModal';
import { useDashboardStore } from '../store/useDashboardStore';
// ¡NUEVO! Importa el gestor de lotes
import BatchManager from '../components/products/BatchManager'; 
import './ProductsPage.css'

export default function ProductsPage() {
    const [activeTab, setActiveTab] = useState('view-products');
    const [categories, setCategories] = useState([]);
    const [editingProduct, setEditingProduct] = useState(null);
    const [isLoading, setIsLoading] = useState(true);
    const [showCategoryModal, setShowCategoryModal] = useState(false);
    
    // ¡NUEVO! Estado para el BatchManager
    const [selectedBatchProductId, setSelectedBatchProductId] = useState(null);

    // Cargar datos desde el store central
    const products = useDashboardStore((state) => state.menu);
    const rawProducts = useDashboardStore((state) => state.rawProducts);
    const rawBatches = useDashboardStore((state) => state.rawBatches); // Necesitamos pasarlo
    const refreshData = useDashboardStore((state) => state.loadAllData);

    const loadCategories = useCallback(async () => {
        // ... (sin cambios)
        setIsLoading(true);
        try {
            const categoryData = await loadData(STORES.CATEGORIES);
            setCategories(categoryData);
        } catch (error) {
            console.error("Error al cargar categorías:", error);
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        loadCategories();
    }, [loadCategories]);

    const handleSaveCategory = async (categoryData) => {
        try {
            await saveData(STORES.CATEGORIES, categoryData);
            await refreshData();
        } catch (error) {
            console.error("Error guardando categoría:", error);
        }
    };

    const handleDeleteCategory = async (categoryId) => {
        try {
            await deleteData(STORES.CATEGORIES, categoryId);
            const productsToUpdate = products.filter(p => p.categoryId === categoryId);
            for (const product of productsToUpdate) {
                product.categoryId = '';
                await saveData(STORES.MENU, product);
            }
            await refreshData();
        } catch (error) {
            console.error("Error eliminando categoría:", error);
        }
    };


    const handleSaveProduct = async (productData, editingProduct) => {
        // ... (sin cambios)
        try {
            if (editingProduct) {
                if (productData.image && productData.image instanceof File) {
                    const imageUrl = await window.uploadFile(productData.image, 'product');
                    productData.image = imageUrl;
                }
                await saveData(STORES.MENU, productData);
                showMessageModal('¡Producto actualizado exitosamente!');
            
            } else {
                showMessageModal('¡Producto guardado exitosamente!');
            }
            await refreshData();
            setEditingProduct(null);
            setActiveTab('view-products');
        } catch (error) {
            console.error("Error al guardar producto:", error);
            showMessageModal(`Error al guardar el producto: ${error.message}`);
        }
    };

    const handleEditProduct = (product) => {
        // ... (sin cambios)
        const productToEdit = rawProducts.find(p => p.id === product.id);
        if (productToEdit) {
            setEditingProduct(productToEdit);
            setActiveTab('add-product');
        } else {
            console.error("No se pudo encontrar el producto original para editar");
        }
    };

    const handleDeleteProduct = async (product) => {
        if (window.confirm(`¿Seguro que quieres eliminar "${product.name}"?`)) {
            try {
                product.deletedTimestamp = new Date().toISOString();
                await saveData(STORES.DELETED_MENU, product);
                await deleteData(STORES.MENU, product.id);
                console.log('Producto movido a la papelera');
                await refreshData();
            } catch (error) {
                console.error("Error al eliminar producto:", error);
            }
        }
    };

    /**
     * Activa o desactiva un producto
     */
    const handleToggleStatus = async (product) => {
        try {
            const updatedProduct = {
                ...product,
                isActive: !(product.isActive !== false) // Invierte el estado
            };
            await saveData(STORES.MENU, updatedProduct);
            await refreshData();
        } catch (error) {
            console.error("Error al cambiar estado:", error);
        }
    };
    
    const handleCancelEdit = () => {
        setEditingProduct(null);
        setActiveTab('view-products');
    };

    // ¡NUEVO! Función para conectar el Form con el BatchManager
    const handleManageBatches = (productId) => {
        setSelectedBatchProductId(productId);
        setActiveTab('batches');
    };

    // VISTA (RENDER)
    return (
        <>
            <h2 className="section-title">Gestión de Productos e Inventario</h2>

            <div className="tabs-container" id="product-tabs">
                <button
                    className={`tab-btn ${activeTab === 'add-product' ? 'active' : ''}`}
                    onClick={() => {
                        setEditingProduct(null);
                        setActiveTab('add-product');
                    }}
                >
                    {editingProduct ? 'Editar Producto' : 'Añadir Producto'}
                </button>
                <button
                    className={`tab-btn ${activeTab === 'view-products' ? 'active' : ''}`}
                    onClick={() => setActiveTab('view-products')}
                >
                    Ver Productos
                </button>
                <button 
                    className={`tab-btn ${activeTab === 'batches' ? 'active' : ''}`}
                    onClick={() => setActiveTab('batches')}
                >
                    Gestionar Lotes
                </button>
            </div>

            {activeTab === 'add-product' && (
                <ProductForm
                    onSave={handleSaveProduct}
                    onCancel={handleCancelEdit}
                    productToEdit={editingProduct}
                    categories={categories}
                    onOpenCategoryManager={() => setShowCategoryModal(true)}
                    products={products}
                    onEdit={handleEditProduct}
                    onManageBatches={handleManageBatches} // ¡Pasamos la nueva función!
                />
            )}
            
            {activeTab === 'view-products' && (
                <ProductList
                    products={products}
                    categories={categories}
                    isLoading={isLoading}
                    onEdit={handleEditProduct}
                    onDelete={handleDeleteProduct}
                    onToggleStatus={handleToggleStatus}
                />
            )}

            {/* ¡NUEVO! Renderiza tu BatchManager aquí */}
            {activeTab === 'batches' && (
                 <BatchManager
                    selectedProductId={selectedBatchProductId}
                    onProductSelect={setSelectedBatchProductId}
                 />
            )}

            <CategoryManagerModal
                show={showCategoryModal}
                onClose={() => setShowCategoryModal(false)}
                categories={categories}
                onSave={handleSaveCategory}
                onDelete={handleDeleteCategory}
            />
        </>
    );
}