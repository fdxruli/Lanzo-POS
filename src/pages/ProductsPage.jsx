// src/pages/ProductsPage.jsx
import React, { useState, useEffect, useCallback } from 'react';
import { loadData, saveData, deleteData, STORES } from '../services/database';
import ProductForm from '../components/products/ProductForm';
import ProductList from '../components/products/ProductList';
import CategoryManagerModal from '../components/products/CategoryManagerModal';
import './ProductsPage.css'

export default function ProductsPage() {
    // ESTADO (sin cambios)
    const [activeTab, setActiveTab] = useState('view-products');
    const [products, setProducts] = useState([]);
    const [categories, setCategories] = useState([]);
    const [editingProduct, setEditingProduct] = useState(null);
    const [isLoading, setIsLoading] = useState(true);
    const [showCategoryModal, setShowCategoryModal] = useState(false);

    // Lógica de carga unificada
    const refreshData = useCallback(async () => {
        setIsLoading(true);
        try {
            const productData = await loadData(STORES.MENU);
            const categoryData = await loadData(STORES.CATEGORIES);
            setProducts(productData);
            setCategories(categoryData);
        } catch (error) {
            console.error("Error al cargar datos:", error);
        } finally {
            setIsLoading(false);
        }
    }, []);

    // Carga de datos única
    useEffect(() => {
        refreshData();
    }, [refreshData]);

    // Funciones de categorías (sin cambios)
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

    /**
     * Guarda o actualiza un producto
     */
    const handleSaveProduct = async (productData) => {
        try {
            const id = editingProduct ? editingProduct.id : `product-${Date.now()}`;
            const isActive = editingProduct ? editingProduct.isActive : true;
            const dataToSave = { ...productData, id, isActive };

            await saveData(STORES.MENU, dataToSave);

            console.log('Producto guardado');
            setEditingProduct(null);
            setActiveTab('view-products');
            await refreshData();
        } catch (error) {
            console.error("Error al guardar producto:", error);
        }
    };

    // ======================================================
    // ¡AQUÍ ESTÁ LA FUNCIÓN QUE FALTABA!
    // ======================================================
    /**
     * Prepara el formulario para edición
     */
    const handleEditProduct = (product) => {
        setEditingProduct(product);
        setActiveTab('add-product');
    };
    // ======================================================

    /**
     * Mueve un producto a la papelera
     */
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
                    Añadir Producto
                </button>
                <button
                    className={`tab-btn ${activeTab === 'view-products' ? 'active' : ''}`}
                    onClick={() => setActiveTab('view-products')}
                >
                    Ver Productos
                </button>
            </div>

            {activeTab === 'add-product' ? (
                <ProductForm
                    onSave={handleSaveProduct}
                    onCancel={handleCancelEdit}
                    productToEdit={editingProduct}
                    categories={categories}
                    onOpenCategoryManager={() => setShowCategoryModal(true)}
                />
            ) : (
                <ProductList
                    products={products}
                    categories={categories}
                    isLoading={isLoading}
                    onEdit={handleEditProduct} // <-- Esta línea ya no dará error
                    onDelete={handleDeleteProduct}
                    onToggleStatus={handleToggleStatus}
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