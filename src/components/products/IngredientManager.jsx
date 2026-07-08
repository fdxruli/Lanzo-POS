import { useId, useReducer } from 'react';
import { Boxes, DollarSign, Layers3, Package, Pencil, Save, Scale, Trash2, X } from 'lucide-react';
import { showConfirmModal } from '../../services/utils';
import './IngredientManager.css';

const getIngredientUnit = (ingredient) => ingredient.bulkData?.purchase?.unit || (ingredient.saleType === 'unit' ? 'pza' : 'kg');

const initialFormState = {
    name: '',
    cost: '',
    stock: '',
    unit: 'kg',
    editingId: null
};

function formReducer(state, action) {
    switch (action.type) {
        case 'field':
            return { ...state, [action.name]: action.value };
        case 'edit':
            return {
                ...initialFormState,
                editingId: action.ingredient.id,
                name: action.ingredient.name || '',
                unit: getIngredientUnit(action.ingredient)
            };
        case 'reset':
            return initialFormState;
        default:
            return state;
    }
}

export default function IngredientManager({ ingredients, onSave, onDelete, onManageBatches }) {
    const fieldId = useId();
    const [formState, dispatchForm] = useReducer(formReducer, initialFormState);
    const { name, cost, stock, unit, editingId } = formState;

    const sortedIngredients = ingredients.toSorted((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'es'));
    const stockedCount = ingredients.filter((ingredient) => Number(ingredient.stock || 0) > 0).length;
    const unitCount = new Set(ingredients.map(getIngredientUnit)).size;

    const resetForm = () => {
        dispatchForm({ type: 'reset' });
    };

    const handleSubmit = (e) => {
        e.preventDefault();
        if (!name.trim()) return;

        const ingredientData = {
            id: editingId,
            name: name.trim(),
            productType: 'ingredient',
            saleType: unit === 'pza' ? 'unit' : 'bulk',
            bulkData: { purchase: { unit } },
            cost: parseFloat(cost) || 0,
            stock: parseFloat(stock) || 0,
            price: 0
        };

        onSave(ingredientData, editingId ? { id: editingId } : null);
        resetForm();
    };

    const handleEdit = (ingredient) => {
        dispatchForm({ type: 'edit', ingredient });
    };

    const handleDelete = async (ingredient) => {
        if (await showConfirmModal(`Eliminar el insumo "${ingredient.name}"?`, {
            title: 'Eliminar insumo',
            confirmButtonText: 'Si, eliminar',
            cancelButtonText: 'Cancelar'
        })) {
            onDelete({ id: ingredient.id, name: ingredient.name || 'Insumo' });
        }
    };

    return (
        <section className="ingredient-manager-container" aria-label="Gestion de ingredientes e insumos">
            <div className="ingredient-manager-header">
                <div className="ingredient-title-group">
                    <span className="ingredient-kicker">
                        <Boxes size={15} />
                        Ingredientes e insumos
                    </span>
                    <div>
                        <h2>Base de produccion</h2>
                        <p>Administra insumos, unidades y acceso rapido a compras o lotes.</p>
                    </div>
                </div>

                <div className="ingredient-status-pill">
                    {ingredients.length} insumo{ingredients.length === 1 ? '' : 's'}
                </div>
            </div>

            <div className="ingredient-metrics" aria-label="Resumen de insumos">
                <div className="ingredient-metric">
                    <span>Total</span>
                    <strong>{ingredients.length}</strong>
                </div>
                <div className="ingredient-metric">
                    <span>Con stock</span>
                    <strong>{stockedCount}</strong>
                </div>
                <div className="ingredient-metric">
                    <span>Sin stock</span>
                    <strong>{Math.max(ingredients.length - stockedCount, 0)}</strong>
                </div>
                <div className="ingredient-metric">
                    <span>Unidades</span>
                    <strong>{unitCount}</strong>
                </div>
            </div>

            <div className="ingredient-manager-layout">
                <aside className="ingredient-form-section">
                    <div className="ingredient-section-heading">
                        <span className="ingredient-section-icon" aria-hidden="true">
                            {editingId ? <Pencil size={17} /> : <Package size={17} />}
                        </span>
                        <div>
                            <h3>{editingId ? 'Editar insumo' : 'Nuevo insumo'}</h3>
                            <p>{editingId ? 'Ajusta nombre y unidad; el stock vive en lotes.' : 'Registra un insumo base para produccion.'}</p>
                        </div>
                    </div>

                    <form onSubmit={handleSubmit} className="ingredient-inline-form">
                        <div className="form-group">
                            <label htmlFor={`${fieldId}-name`}>
                                <Package size={14} />
                                Nombre del insumo
                            </label>
                            <input
                                id={`${fieldId}-name`}
                                type="text"
                                className="form-input"
                                placeholder="Ej: Harina, tomate, carne"
                                value={name}
                                onChange={(e) => dispatchForm({ type: 'field', name: 'name', value: e.target.value })}
                                required
                                aria-label="Nombre del insumo"
                            />
                        </div>

                        <div className="form-group">
                            <label htmlFor={`${fieldId}-unit`}>
                                <Scale size={14} />
                                Unidad
                            </label>
                            <select
                                id={`${fieldId}-unit`}
                                className="form-input"
                                value={unit}
                                onChange={(e) => dispatchForm({ type: 'field', name: 'unit', value: e.target.value })}
                                aria-label="Unidad del insumo"
                            >
                                <option value="kg">Kilogramos (kg)</option>
                                <option value="lt">Litros (L)</option>
                                <option value="gr">Gramos (gr)</option>
                                <option value="ml">Mililitros (ml)</option>
                                <option value="pza">Pieza / Unidad</option>
                            </select>
                        </div>

                        {!editingId && (
                            <div className="ingredient-form-row">
                                <div className="form-group">
                                    <label htmlFor={`${fieldId}-cost`}>
                                        <DollarSign size={14} />
                                        Costo compra
                                    </label>
                                    <input
                                        id={`${fieldId}-cost`}
                                        type="number"
                                        className="form-input"
                                        placeholder="0.00"
                                        step="0.01"
                                        value={cost}
                                        onChange={(e) => dispatchForm({ type: 'field', name: 'cost', value: e.target.value })}
                                        aria-label="Costo de compra"
                                    />
                                </div>
                                <div className="form-group">
                                    <label htmlFor={`${fieldId}-stock`}>
                                        <Layers3 size={14} />
                                        Stock inicial
                                    </label>
                                    <input
                                        id={`${fieldId}-stock`}
                                        type="number"
                                        className="form-input"
                                        placeholder="0"
                                        step="0.01"
                                        value={stock}
                                        onChange={(e) => dispatchForm({ type: 'field', name: 'stock', value: e.target.value })}
                                        aria-label="Stock inicial"
                                    />
                                </div>
                            </div>
                        )}

                        <div className="ingredient-form-actions">
                            <button type="submit" className="btn btn-save">
                                <Save size={16} />
                                {editingId ? 'Actualizar' : 'Guardar'}
                            </button>
                            {editingId && (
                                <button type="button" className="btn btn-cancel" onClick={resetForm}>
                                    <X size={16} />
                                    Cancelar
                                </button>
                            )}
                        </div>
                    </form>
                </aside>

                <div className="ingredient-list-section">
                    <div className="ingredient-list-header">
                        <div>
                            <h3>Inventario de insumos</h3>
                            <p>{sortedIngredients.length > 0 ? 'Edita datos base o abre compras/lotes.' : 'Agrega el primer insumo para iniciar produccion.'}</p>
                        </div>
                    </div>

                    {sortedIngredients.length === 0 ? (
                        <div className="ingredient-empty-message">
                            <Package size={42} />
                            <strong>Sin insumos registrados</strong>
                            <span>Usa el formulario para anadir tu primer insumo.</span>
                        </div>
                    ) : (
                        <div className="ingredient-list-grid">
                            {sortedIngredients.map((ingredient) => {
                                const ingredientUnit = getIngredientUnit(ingredient);
                                return (
                                    <article key={ingredient.id} className="ingredient-card-item">
                                        <div className="ingredient-card-main">
                                            <span className="ingredient-card-icon" aria-hidden="true">
                                                <Package size={17} />
                                            </span>
                                            <div className="ing-info">
                                                <h4 className="ing-name">{ingredient.name}</h4>
                                                <div className="ing-details">
                                                    <span className="ing-stock">
                                                        Stock <strong>{ingredient.stock || 0} {ingredientUnit}</strong>
                                                    </span>
                                                    <span className="ing-cost">
                                                        Costo <strong>${ingredient.cost?.toFixed(2) || '0.00'}</strong>
                                                    </span>
                                                </div>
                                            </div>
                                        </div>

                                        <div className="ing-actions">
                                            <button
                                                type="button"
                                                className="ingredient-icon-button batches"
                                                onClick={() => onManageBatches(ingredient.id)}
                                                title="Gestionar compras o lotes"
                                                aria-label={`Gestionar compras o lotes de ${ingredient.name}`}
                                            >
                                                <Package size={16} />
                                            </button>
                                            <button
                                                type="button"
                                                className="ingredient-icon-button edit"
                                                onClick={() => handleEdit(ingredient)}
                                                title="Editar nombre o unidad"
                                                aria-label={`Editar ${ingredient.name}`}
                                            >
                                                <Pencil size={16} />
                                            </button>
                                            <button
                                                type="button"
                                                className="ingredient-icon-button delete"
                                                onClick={() => handleDelete(ingredient)}
                                                title="Eliminar"
                                                aria-label={`Eliminar ${ingredient.name}`}
                                            >
                                                <Trash2 size={16} />
                                            </button>
                                        </div>
                                    </article>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>
        </section>
    );
}