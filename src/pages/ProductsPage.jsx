// src/pages/ProductsPage.jsx
import React, { useState, useEffect, useCallback } from 'react';
// 1. CORRECCIÓN: Agregamos 'saveBulk' a las importaciones
import { loadData, saveData, deleteData, saveBulk, STORES } from '../services/database';
import { showMessageModal } from '../services/utils';
import ProductForm from '../components/products/ProductForm';
import ProductList from '../components/products/ProductList';
import CategoryManagerModal from '../components/products/CategoryManagerModal';
import { useDashboardStore } from '../store/useDashboardStore';
import BatchManager from '../components/products/BatchManager';
import './ProductsPage.css';

export default function ProductsPage() {
    const [activeTab, setActiveTab] = useState('view-products');
    const [categories, setCategories] = useState([]);
    const [editingProduct, setEditingProduct] = useState(null);
    const [isLoading, setIsLoading] = useState(true);
    const [showCategoryModal, setShowCategoryModal] = useState(false);

    // Estado para el BatchManager
    const [selectedBatchProductId, setSelectedBatchProductId] = useState(null);

    // Cargar datos desde el store central
    const products = useDashboardStore((state) => state.menu);
    const rawProducts = useDashboardStore((state) => state.rawProducts);
    const rawBatches = useDashboardStore((state) => state.rawBatches);
    const refreshData = useDashboardStore((state) => state.loadAllData);

    const loadCategories = useCallback(async () => {
        setIsLoading(true);
        try {
            const categoryData = await loadData(STORES.CATEGORIES);
            setCategories(categoryData || []);
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
            // Actualizar productos que tenían esta categoría
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

    // 2. CORRECCIÓN: Lógica completa de guardado (Crear y Editar)
    const handleSaveProduct = async (productData, editingProduct) => {
        setIsLoading(true);
        try {
            // A. Manejo de IMAGEN (común para crear o editar)
            let finalImage = productData.image;
            if (productData.image && productData.image instanceof File) {
                // Subir imagen si es un archivo nuevo
                finalImage = await window.uploadFile(productData.image, 'product');
            }

            if (editingProduct) {
                // --- CASO: EDITAR PRODUCTO EXISTENTE ---
                const updatedProduct = {
                    ...editingProduct, // Mantenemos datos viejos (ID, stock, etc.)
                    ...productData,    // Sobreescribimos con los nuevos
                    image: finalImage, // Usamos la URL (o null)
                    updatedAt: new Date().toISOString()
                };

                await saveData(STORES.MENU, updatedProduct);
                showMessageModal('¡Producto actualizado exitosamente!');

            } else {
                // --- CASO: CREAR NUEVO PRODUCTO ---
                
                // 1. Generamos un ID único
                const newId = `product-${Date.now()}`;

                const newProduct = {
                    id: newId,
                    ...productData,
                    image: finalImage,
                    isActive: true,     // Por defecto activo
                    createdAt: new Date().toISOString(),
                    // Inicializamos batchManagement para evitar errores futuros
                    batchManagement: { enabled: false, selectionStrategy: 'fifo' },
                    stock: 0, // Stock inicial 0 (se llena con lotes)
                    price: 0  // Precio inicial 0 (se llena con lotes o lógica agregada)
                };

                // 2. ¡GUARDAMOS EN LA BASE DE DATOS!
                await saveData(STORES.MENU, newProduct);

                showMessageModal('¡Producto guardado exitosamente!');
            }

            // 3. Actualizamos la vista global
            await refreshData();

            // 4. Limpiamos el formulario y volvemos a la lista
            setEditingProduct(null);
            setActiveTab('view-products');

        } catch (error) {
            console.error("Error al guardar producto:", error);
            showMessageModal(`Error al guardar el producto: ${error.message}`);
        } finally {
            setIsLoading(false);
        }
    };

    const handleEditProduct = (product) => {
        // Buscamos el producto "crudo" (sin agregaciones) para editar
        const productToEdit = rawProducts.find(p => p.id === product.id);
        if (productToEdit) {
            setEditingProduct(productToEdit);
            setActiveTab('add-product');
        } else {
            console.error("No se pudo encontrar el producto original para editar");
        }
    };

    // 3. CORRECCIÓN: Eliminación profunda (Producto + Lotes)
    const handleDeleteProduct = async (product) => {
        if (window.confirm(`¿Seguro que quieres eliminar "${product.name}"?`)) {
            try {
                // 1. Mover producto a papelera
                product.deletedTimestamp = new Date().toISOString();
                await saveData(STORES.DELETED_MENU, product);
                await deleteData(STORES.MENU, product.id);

                // 2. Desactivar/Eliminar lotes asociados para evitar huérfanos
                // Buscamos los lotes de este producto en el store global
                const productBatches = rawBatches.filter(b => b.productId === product.id);
                
                if (productBatches.length > 0) {
                    // Los marcamos como inactivos y con stock 0
                    const updatedBatches = productBatches.map(b => ({
                        ...b,
                        isActive: false,
                        stock: 0,
                        notes: (b.notes || '') + ' [Producto Eliminado]'
                    }));
                    // Guardamos todos los lotes actualizados de una vez
                    await saveBulk(STORES.PRODUCT_BATCHES, updatedBatches);
                }

                console.log('Producto y sus lotes movidos a la papelera');
                
                await refreshData();
                showMessageModal('Producto eliminado correctamente.');

            } catch (error) {
                console.error("Error al eliminar producto:", error);
                showMessageModal(`Error al eliminar: ${error.message}`);
            }
        }
    };

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
                    onManageBatches={handleManageBatches}
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