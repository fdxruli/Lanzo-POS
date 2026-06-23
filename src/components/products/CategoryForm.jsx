import React, { useState, useEffect } from 'react';

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
  const [formData, setFormData] = useState(DEFAULT_CATEGORY_FORM);
  const [error, setError] = useState('');

  const resetForm = () => {
    setFormData({ ...DEFAULT_CATEGORY_FORM });
    setError('');
  };

  useEffect(() => {
    setFormData(buildCategoryFormData(initialData));
    setError('');
  }, [initialData]);

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
        throw new Error('No se configuró el guardado de categorías.');
      }

      const savedCategory = await onSave(normalizedFormData);

      await Promise.resolve(onSaveSuccess?.(savedCategory));

      resetForm();
    } catch (err) {
      setError(err.message || 'No se pudo guardar la categoría.');
    }
  };

  const handleCancel = () => {
    resetForm();
    onCancel?.();
  };

  return (
    <form onSubmit={handleSubmit} className="category-form">
      {error && <div style={{ color: 'red', marginBottom: '10px' }}>{error}</div>}

      <div className="form-group">
        <label>Nombre</label>
        <input
          type="text"
          value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          autoFocus
        />
      </div>

      <div style={{ display: 'flex', gap: '10px' }}>
        <div className="form-group">
          <label>Color P.V.</label>
          <input
            type="color"
            value={formData.color}
            onChange={(e) => setFormData({ ...formData, color: e.target.value })}
          />
        </div>

        <div className="form-group">
          <label>Orden de visualización</label>
          <input
            type="number"
            value={formData.sortOrder}
            onChange={(e) => setFormData({ ...formData, sortOrder: Number(e.target.value) })}
          />
        </div>
      </div>

      <div style={{ display: 'flex', gap: '10px', marginTop: '15px' }}>
        <button type="submit" className="btn btn-save">
          {formData.id ? 'Actualizar' : 'Guardar'}
        </button>
        {onCancel && (
          <button type="button" className="btn btn-cancel" onClick={handleCancel}>
            Cancelar
          </button>
        )}
      </div>
    </form>
  );
}