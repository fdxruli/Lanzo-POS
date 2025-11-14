import React, { useState, useEffect } from 'react';
import { loadData, saveData, deleteData, STORES } from '../services/database';
import ProductForm from '../components/products/ProductForm';
import ProductList from '../components/products/ProductList';
import CategoryManagerModal from '../components/products/CategoryManagerModal';
import './ProductsPage.css'

export default function ProductsPage() {
    // 1. ESTADO
    const [activeTab, setActiveTab] = useState('view-products'); // Empezamos en "Ver"
    const [products, setProducts] = useState([]);
    const [categories, setCategories] = useState([]);
    const [editingProduct, setEditingProduct] = useState(null);
    const [isLoading, setIsLoading] = useState(true);

    const [showCategoryModal, setShowCategoryModal] = useState(false);

    useEffect(() => {
        loadProductsAndCategories();
    }, []);

    const handleSaveCategory = async (categoryData) => {
        try {
            await saveData(STORES.CATEGORIES, categoryData);
            loadProductsAndCategories(); // Recarga todo
            // (Aquí iría showMessageModal)
        } catch (error) {
            console.error("Error guardando categoría:", error);
        }
    };

    const handleDeleteCategory = async (categoryId) => {
        try {
            await deleteData(STORES.CATEGORIES, categoryId);
            // Des-asigna la categoría de los productos
            const productsToUpdate = products.filter(p => p.categoryId === categoryId);
            for (const product of productsToUpdate) {
                product.categoryId = '';
                await saveData(STORES.MENU, product);
            }
            loadProductsAndCategories(); // Recarga todo
        } catch (error) {
            console.error("Error eliminando categoría:", error);
        }
    };

    const loadProductsAndCategories = async () => {
        setIsLoading(true);
        try {
            const productData = await loadData(STORES.MENU);
            const categoryData = await loadData(STORES.CATEGORIES);
            setProducts(productData);
            setCategories(categoryData);
        } catch (error) {
            console.error("Error al cargar datos:", error);
        }
        setIsLoading(false);
    };

    /**
     * Guarda o actualiza un producto
     * Reemplaza 'saveProduct' de app.js
     */
    const handleSaveProduct = async (productData) => {
        try {
            const id = editingProduct ? editingProduct.id : `product-${Date.now()}`;
            // Mantenemos el estado 'isActive' si estamos editando
            const isActive = editingProduct ? editingProduct.isActive : true;

            const dataToSave = { ...productData, id, isActive };

            await saveData(STORES.MENU, dataToSave);

            // (Aquí irá la lógica de guardar ingredientes si la migras)

            console.log('Producto guardado');
            setEditingProduct(null); // Limpiamos la edición
            setActiveTab('view-products'); // Volvemos a la lista
            loadProductsAndCategories(); // Recargamos todo
        } catch (error) {
            console.error("Error al guardar producto:", error);
        }
    };

    /**
     * Prepara el formulario para edición
     * Reemplaza 'editProductForm' de app.js
     */
    const handleEditProduct = (product) => {
        setEditingProduct(product);
        setActiveTab('add-product');
    };

    /**
     * Mueve un producto a la papelera
     * Reemplaza 'deleteProduct' de app.js
     */
    const handleDeleteProduct = async (product) => {
        if (window.confirm(`¿Seguro que quieres eliminar "${product.name}"?`)) {
            try {
                // Mover a la papelera
                product.deletedTimestamp = new Date().toISOString();
                await saveData(STORES.DELETED_MENU, product);
                // Borrar de la lista principal
                await deleteData(STORES.MENU, product.id);

                console.log('Producto movido a la papelera');
                loadProductsAndCategories(); // Recargamos
            } catch (error) {
                console.error("Error al eliminar producto:", error);
            }
        }
    };

    /**
     * Activa o desactiva un producto
     * Reemplaza la lógica del 'btn-toggle-status' en app.js
     */
    const handleToggleStatus = async (product) => {
        try {
            const updatedProduct = {
                ...product,
                isActive: !(product.isActive !== false) // Invierte el estado
            };
            await saveData(STORES.MENU, updatedProduct);
            loadProductsAndCategories(); // Recargamos
        } catch (error) {
            console.error("Error al cambiar estado:", error);
        }
    };

    const handleCancelEdit = () => {
        setEditingProduct(null);
        setActiveTab('view-products');
    };

    // 4. VISTA
    return (
        <>
            <h2 className="section-title">Gestión de Productos e Inventario</h2>

            <div className="tabs-container" id="product-tabs">
                <button
                    className={`tab-btn ${activeTab === 'add-product' ? 'active' : ''}`}
                    onClick={() => {
                        setEditingProduct(null); // Asegura que sea un form "nuevo"
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
                    categories={categories} // Pasamos categorías para el nombre
                    isLoading={isLoading}
                    onEdit={handleEditProduct}
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