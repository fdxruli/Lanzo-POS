import { useId, useRef, useState } from 'react';
import { ListOrdered, Palette, Save, Tag, X } from 'lucide-react';

const DEFAULT_CATEGORY_FORM = {
  id: '',
  name: '',
  color: '#3b82f6',
  sortOrder: 0,
  serverVersion: null
};

const buildCategoryFormData = (category) => {
  if (!category) {
    return { ...DEFAULT_CATEGORY_FORM };
  }

  return {
    id: category.id || '',
    name: category.name || '',
    color: category.color || DEFAULT_CATEGORY_FORM.color,
    sortOrder: category.sortOrder || 0,
    serverVersion: category.serverVersion ?? category.server_version ?? null
  };
};

export default function CategoryForm({ initialData, onSave, onSaveSuccess, onCancel }) {
  const fieldId = useId();
  const [prevInitialData, setPrevInitialData] = useState(initialData);
  const [formData, setFormData] = useState(() => buildCategoryFormData(initialData));
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [hasVersionConflict, setHasVersionConflict] = useState(false);
  const isSavingRef = useRef(false);

  if (initialData !== prevInitialData) {
    setPrevInitialData(initialData);
    setFormData(buildCategoryFormData(initialData));
    if (error) setError('');
    if (initialData && status) setStatus('');
    setHasVersionConflict(false);
  }

  const resetForm = () => {
    setFormData({ ...DEFAULT_CATEGORY_FORM });
    setError('');
    setStatus('');
    setHasVersionConflict(false);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (isSavingRef.current || hasVersionConflict) return;
    setError('');
    setStatus('');

    const normalizedFormData = {
      ...formData,
      name: formData.name.trim(),
      sortOrder: Number(formData.sortOrder) || 0
    };

    if (!normalizedFormData.name) {
      setError('El nombre es obligatorio.');
      return;
    }

    isSavingRef.current = true;
    setIsSaving(true);

    try {
      if (!onSave) {
        throw new Error('No se configuro el guardado de categorias.');
      }

      const savedCategory = await onSave(normalizedFormData);
      if (savedCategory?.success === false) {
        const saveError = savedCategory.error instanceof Error
          ? savedCategory.error
          : new Error(savedCategory.message || savedCategory.error?.message || savedCategory.code || 'No se pudo guardar la categoria.');
        saveError.code = saveError.code || savedCategory.code || savedCategory.error?.code;
        throw saveError;
      }

      await Promise.resolve(onSaveSuccess?.(savedCategory));

      resetForm();
      if (savedCategory?.saveStatus === 'pending' || savedCategory?.pending) {
        setStatus('Categoría guardada en este dispositivo. La sincronización está pendiente.');
      } else if (savedCategory?.saveStatus === 'confirmed') {
        setStatus('Categoría guardada y confirmada en la nube.');
      } else {
        setStatus('Categoría guardada.');
      }
    } catch (err) {
      if (err?.code === 'VERSION_CONFLICT') setHasVersionConflict(true);
      if (!err?.categorySaveHandledByModal) {
        setError(err?.message || (typeof err === 'string' ? err : 'No se pudo guardar la categoria.'));
      }
    } finally {
      isSavingRef.current = false;
      setIsSaving(false);
    }
  };

  const handleCancel = () => {
    if (isSavingRef.current) return;
    resetForm();
    onCancel?.();
  };

  return (
    <form onSubmit={handleSubmit} className="category-form" aria-busy={isSaving}>
      {error && <div className="category-form-error" role="alert">{error}</div>}
      {status && (
        <div className={`category-form-status${status.includes('pendiente') ? ' category-form-status--pending' : ''}`} role="status" aria-live="polite">
          {status}
        </div>
      )}

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
          disabled={isSaving || hasVersionConflict}
          onChange={(e) => {
            setStatus('');
            setFormData({ ...formData, name: e.target.value });
          }}
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
            disabled={isSaving || hasVersionConflict}
            onChange={(e) => {
              setStatus('');
              setFormData({ ...formData, color: e.target.value });
            }}
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
            disabled={isSaving || hasVersionConflict}
            onChange={(e) => {
              setStatus('');
              setFormData({ ...formData, sortOrder: Number(e.target.value) });
            }}
          />
        </div>
      </div>

      <div className="category-form-actions">
        <button type="submit" className="btn btn-save" disabled={isSaving || hasVersionConflict}>
          <Save size={16} />
          {isSaving ? 'Guardando…' : (formData.id ? 'Actualizar' : 'Guardar')}
        </button>
        {onCancel && (
          <button type="button" className="btn btn-cancel" onClick={handleCancel} disabled={isSaving}>
            <X size={16} />
            Cancelar
          </button>
        )}
      </div>
    </form>
  );
}
