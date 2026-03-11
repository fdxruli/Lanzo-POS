import React, { useState, useEffect } from 'react';
import { categoriesRepository } from '../../services/db/general'; // Ajusta la ruta

export default function CategoryForm({ initialData, onSaveSuccess, onCancel }) {
  const [formData, setFormData] = useState({
    id: '', name: '', color: '#3b82f6', sortOrder: 0
  });
  const [error, setError] = useState('');

  useEffect(() => {
    if (initialData) {
      setFormData({
        id: initialData.id,
        name: initialData.name,
        color: initialData.color || '#3b82f6',
        sortOrder: initialData.sortOrder || 0
      });
    }
  }, [initialData]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    
    if (!formData.name.trim()) {
      setError('El nombre es obligatorio.');
      return;
    }

    try {
      await categoriesRepository.saveCategory(formData);
      onSaveSuccess();
      if (!initialData) {
        setFormData({ id: '', name: '', color: '#3b82f6', sortOrder: 0 }); // Reset si es nuevo
      }
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="category-form">
      {error && <div style={{ color: 'red', marginBottom: '10px' }}>{error}</div>}
      
      <div className="form-group">
        <label>Nombre</label>
        <input 
          type="text" 
          value={formData.name}
          onChange={(e) => setFormData({...formData, name: e.target.value})}
          autoFocus
        />
      </div>

      <div style={{ display: 'flex', gap: '10px' }}>
        <div className="form-group">
          <label>Color P.V.</label>
          <input 
            type="color" 
            value={formData.color}
            onChange={(e) => setFormData({...formData, color: e.target.value})}
          />
        </div>
        
        <div className="form-group">
          <label>Orden de visualización</label>
          <input 
            type="number" 
            value={formData.sortOrder}
            onChange={(e) => setFormData({...formData, sortOrder: Number(e.target.value)})}
          />
        </div>
      </div>

      <div style={{ display: 'flex', gap: '10px', marginTop: '15px' }}>
        <button type="submit" className="btn btn-save">
          {formData.id ? 'Actualizar' : 'Guardar'}
        </button>
        {onCancel && (
          <button type="button" className="btn btn-cancel" onClick={onCancel}>
            Cancelar
          </button>
        )}
      </div>
    </form>
  );
}