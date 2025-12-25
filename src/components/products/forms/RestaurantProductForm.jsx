import React, { useState, useEffect, useMemo } from 'react';
import { useProductCommon } from '../../../hooks/useProductCommon';
import CommonProductFields from './CommonProductFields';
import RestauranteFields from '../fieldsets/RestauranteFields';
import RecipeBuilderModal from '../RecipeBuilderModal';
import { generateID, showMessageModal, roundCurrency } from '../../../services/utils';

export default function RestaurantProductForm({ onSave, onCancel, productToEdit, categories, onOpenCategoryManager, activeRubroContext }) {
    const common = useProductCommon(productToEdit);

    // Estados específicos de Restaurante
    const [productType, setProductType] = useState(productToEdit?.productType || 'sellable');
    const [recipe, setRecipe] = useState(productToEdit?.recipe || []);
    const [printStation, setPrintStation] = useState(productToEdit?.printStation || 'kitchen');
    const [prepTime, setPrepTime] = useState(productToEdit?.prepTime || '');
    const [modifiers, setModifiers] = useState(productToEdit?.modifiers || []);
    const [isRecipeModalOpen, setIsRecipeModalOpen] = useState(false);

    // LOGICA INTELIGENTE 1: Configuración de Stock según Tipo
    useEffect(() => {
        if (!productToEdit) {
            if (productType === 'sellable') {
                common.setDoesTrackStock(false); // Platillo: No stock directo, usa receta
            } else if (productType === 'ingredient') {
                common.setDoesTrackStock(true);  // Insumo: Sí stock directo
            }
        }
    }, [productType]);

    // LOGICA INTELIGENTE 2: Sincronización Receta -> Costo
    // Si la receta cambia, calculamos el nuevo costo teórico y actualizamos el formulario base
    useEffect(() => {
        if (productType === 'sellable' && recipe.length > 0) {
            const totalRecipeCost = recipe.reduce((acc, item) => acc + (item.estimatedCost || 0), 0);
            
            // Solo actualizamos si hay una diferencia significativa para evitar loops
            // Asumimos que common expone setCost (parte del hook useProductCommon)
            if (common.cost !== totalRecipeCost) {
                console.log("🔄 Sincronizando costo desde receta:", totalRecipeCost);
                if(common.setCost) common.setCost(roundCurrency(totalRecipeCost));
            }
        }
    }, [recipe, productType]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (common.isSaving) return;

        // --- VALIDACIONES DE ROBUSTEZ ---

        // 1. Receta Vacía en Platillos
        if (productType === 'sellable' && recipe.length === 0) {
            showMessageModal('⚠️ Receta Vacía', 'Un platillo de venta debe tener al menos un ingrediente o insumo para descontar inventario.', { type: 'error' });
            return;
        }

        // 2. Alerta de Rentabilidad Negativa (Loss Prevention)
        const currentPrice = parseFloat(common.price) || 0;
        const currentCost = parseFloat(common.cost) || 0;
        
        if (productType === 'sellable' && currentPrice < currentCost) {
            const confirmLoss = window.confirm(`⚠️ ¡ALERTA DE PÉRDIDA!\n\nEl precio de venta ($${currentPrice}) es MENOR al costo de la receta ($${currentCost}).\n\n¿Estás seguro que deseas guardar con pérdidas?`);
            if (!confirmLoss) return;
        }

        // 3. Modificadores sin opciones
        const invalidModifier = modifiers.find(m => m.options.length === 0);
        if (invalidModifier) {
            showMessageModal('⚠️ Configuración Incompleta', `El grupo de modificadores "${invalidModifier.name}" no tiene opciones. Elimínalo o agrega opciones.`, { type: 'error' });
            return;
        }

        common.setIsSaving(true);
        try {
            const commonData = common.getCommonData();
            const productId = productToEdit?.id || generateID('prod');

            const payload = {
                id: productId,
                ...commonData,
                rubroContext: activeRubroContext,
                productType,
                recipe,
                printStation,
                prepTime,
                modifiers,
                saleType: productType === 'sellable' ? 'unit' : (commonData.saleType || 'unit'),
                batchManagement: productType === 'ingredient' ? { enabled: true } : { enabled: false }, // Insumos manejan lotes
                ...(productToEdit ? {} : { createdAt: new Date().toISOString() })
            };

            // Insumos nuevos inician con stock 0 si no se definió
            if (!productToEdit && productType === 'ingredient' && payload.stock === undefined) {
                payload.stock = 0;
            }

            await onSave(payload, productToEdit || { id: productId, isNew: true });
        } catch (error) {
            console.error(error);
            showMessageModal('Error al guardar', error.message, { type: 'error' });
        } finally {
            common.setIsSaving(false);
        }
    };

    return (
        <>
            <form onSubmit={handleSubmit}>
                {/* Pasamos productType a common fields si necesitamos lógica visual extra allí */}
                <CommonProductFields 
                    common={common} 
                    categories={categories} 
                    onOpenCategoryManager={onOpenCategoryManager}
                    readOnlyCost={productType === 'sellable' && recipe.length > 0} // Bloquear edición manual de costo si viene de receta
                />

                <div className="module-section" style={{ borderTop: '2px solid #fdba74', marginTop: '25px', paddingTop: '20px', position: 'relative' }}>
                    <span style={{ 
                        position: 'absolute', top: '-14px', left: '15px', 
                        background: '#fff7ed', padding: '0 8px', borderRadius: '4px',
                        fontSize: '0.85rem', color: '#ea580c', fontWeight: 'bold', border: '1px solid #fdba74' 
                    }}>
                        🍽️ Configuración de Restaurante
                    </span>
                    
                    <RestauranteFields
                        productType={productType} setProductType={setProductType}
                        onManageRecipe={() => setIsRecipeModalOpen(true)}
                        printStation={printStation} setPrintStation={setPrintStation}
                        prepTime={prepTime} setPrepTime={setPrepTime}
                        modifiers={modifiers} setModifiers={setModifiers}
                        recipeCount={recipe.length} // Para mostrar feedback visual
                        currentCost={common.cost}   // Para mostrar costo calculado
                    />
                </div>

                <div style={{ marginTop: '25px', display: 'flex', gap: '15px', paddingTop: '15px', borderTop: '1px solid #eee' }}>
                    <button type="submit" className="btn btn-save" style={{ flex: 2, padding: '12px', fontSize: '1.1rem' }} disabled={common.isSaving}>
                        {common.isSaving ? '⏳ Guardando...' : (productType === 'sellable' ? '💾 Guardar Platillo' : '💾 Guardar Insumo')}
                    </button>
                    <button type="button" className="btn btn-cancel" style={{ flex: 1 }} onClick={onCancel}>
                        Cancelar
                    </button>
                </div>
            </form>
            
            <RecipeBuilderModal 
                show={isRecipeModalOpen} 
                onClose={() => setIsRecipeModalOpen(false)} 
                existingRecipe={recipe} 
                onSave={setRecipe} 
                productName={common.name} 
            />
        </>
    );
}