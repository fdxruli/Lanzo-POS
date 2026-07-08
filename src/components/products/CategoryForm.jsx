import { useId, useState } from 'react';
import { ListOrdered, Palette, Save, Tag, X } from 'lucide-react';

const DEFAULT_CATEGORY_FORM = {
  id: '',
  name: '',
  color: '#3b82f6',
  sortOrder: 0
};

const buildCategoryFormData = (category) => {
  if (!category) {
    return { ...DEFAULT_CATEGORY_FORM };
  }

  return {
    id: category.id || '',
    name: category.name || '',
    color: category.color || DEFAULT_CATEGORY_FORM.color,
    sortOrder: category.sortOrder || 0
  };
};

export default function CategoryForm({ initialData, onSave, onSaveSuccess, onCancel }) {
  const fieldId = useId();
  const [prevInitialData, setPrevInitialData] = useState(initialData);
  const [formData, setFormData] = useState(() => buildCategoryFormData(initialData));
  const [error, setError] = useState('');

  if (initialData !== prevInitialData) {
    setPrevInitialData(initialData);
    setFormData(buildCategoryFormData(initialData));
    if (error) setError('');
  }

  const resetForm = () => {
    setFormData({ ...DEFAULT_CATEGORY_FORM });
    setError('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    const normalizedFormData = {
      ...formData,
      name: formData.name.trim(),
      sortOrder: Number(formData.sortOrder) || 0
    };

    if (!normalizedFormData.name) {
      setError('El nombre es obligatorio.');
      return;
    }

    try {
      if (!onSave) {
        throw new Error('No se configuro el guardado de categorias.');
      }

      const savedCategory = await onSave(normalizedFormData);

      await Promise.resolve(onSaveSuccess?.(savedCategory));

      resetForm();
    } catch (err) {
      setError(err.message || 'No se pudo guardar la categoria.');
    }
  };

  const handleCancel = () => {
    resetForm();
    onCancel?.();
  };

  return (
    <form onSubmit={handleSubmit} className="category-form">
      {error && <div className="category-form-error">{error}</div>}

      <div className="form-group">
        <label htmlFor={`${fieldId}-name`}>
          <Tag size={14} />
          Nombre
        </label>
        <input
          id={`${fieldId}-name`}
          type="text"
          className="form-input"
          aria-label="Nombre de la categoria"
          value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
        />
      </div>

      <div className="category-form-row">
        <div className="form-group">
          <label htmlFor={`${fieldId}-color`}>
            <Palette size={14} />
            Color P.V.
          </label>
          <input
            id={`${fieldId}-color`}
            type="color"
            className="category-color-input"
            aria-label="Color de la categoria"
            value={formData.color}
            onChange={(e) => setFormData({ ...formData, color: e.target.value })}
          />
        </div>

        <div className="form-group">
          <label htmlFor={`${fieldId}-sort-order`}>
            <ListOrdered size={14} />
            Orden
          </label>
          <input
            id={`${fieldId}-sort-order`}
            type="number"
            className="form-input"
            aria-label="Orden de visualizacion"
            value={formData.sortOrder}
            onChange={(e) => setFormData({ ...formData, sortOrder: Number(e.target.value) })}
          />
        </div>
      </div>

      <div className="category-form-actions">
        <button type="submit" className="btn btn-save">
          <Save size={16} />
          {formData.id ? 'Actualizar' : 'Guardar'}
        </button>
        {onCancel && (
          <button type="button" className="btn btn-cancel" onClick={handleCancel}>
            <X size={16} />
            Cancelar
          </button>
        )}
      </div>
    </form>
  );
}
