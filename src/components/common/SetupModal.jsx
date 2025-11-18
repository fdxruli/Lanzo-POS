// src/components/common/SetupModal.jsx
import React, { useState } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { compressImage } from '../../services/utils'; // Importamos el compresor
import './SetupModal.css';

const logoPlaceholder = 'https://placehold.co/100x100/FFFFFF/4A5568?text=L';

// --- ¡NUEVO! ---
// 1. Definimos los nuevos rubros agrupados
const BUSINESS_RUBROS = [
  { id: 'food_service', label: 'Restaurante / Cocina' },
  { id: 'abarrotes', label: 'Abarrotes' },
  { id: 'farmacia', label: 'Farmacia' },
  { id: 'verduleria/fruteria', label: 'Frutería / Verdulería' },
  { id: 'apparel', label: 'Ropa / Calzado' },
  { id: 'hardware', label: 'Ferretería' },
  { id: 'otro', label: 'Otro' },
];
// --- Fin de la Modificación ---

export default function SetupModal() {
  // 1. Conectamos al store
  const handleSetup = useAppStore((state) => state.handleSetup);

  // 2. Estado local para el formulario
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [logoPreview, setLogoPreview] = useState(logoPlaceholder);
  const [logoData, setLogoData] = useState(null); // Esto ahora guardará el FILE
  const [selectedTypes, setSelectedTypes] = useState([]);
  const [error, setError] = useState('');

  // Lógica de 'business-type-selection'
  const handleTypeClick = (value) => {
    setError('');
    setSelectedTypes(prev => {
      if (prev.includes(value)) {
        return prev.filter(t => t !== value);
      }
      if (prev.length < 4) {
        return [...prev, value];
      }
      return prev;
    });
  };

  // ¡MODIFICADO! Lógica de compresión de imagen
  const handleImageChange = async (e) => {
    const file = e.target.files[0];
    if (file) {
      try {
        const compressedFile = await compressImage(file); // 1. Llama a la nueva función
        
        // 2. Crea una URL local para la vista previa
        setLogoPreview(URL.createObjectURL(compressedFile)); 
        
        // 3. Guarda el ARCHIVO (File object) en el estado
        setLogoData(compressedFile); 
      
      } catch (error) {
        console.error("Error al comprimir imagen:", error);
      }
    }
  };

  // 3. Manejador de envío
  // El store se encargará de la lógica de subida
  const handleSubmit = (e) => {
    e.preventDefault();
    if (selectedTypes.length === 0) {
      setError('Debes seleccionar al menos un rubro.');
      return;
    }
    
    // Llamamos a la acción del store
    handleSetup({
      name,
      phone,
      address,
      logo: logoData, // Pasa el FILE object
      business_type: selectedTypes
    });
    // El store se encargará de cambiar el 'appStatus' a 'ready'
  };

  // 4. HTML de 'business-setup-modal' traducido a JSX
  return (
    <div id="business-setup-modal" className="modal" style={{ display: 'flex' }}>
      <div className="modal-content">
        <h2>Configura tu Negocio</h2>
        <p style={{ marginBottom: 'var(--spacing-lg)' }}>
          ¡Felicidades por activar tu licencia! Ahora, personalicemos la información de tu negocio.
        </p>
        <form id="business-setup-form" onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label" htmlFor="setup-company-name">Nombre del Negocio *</label>
            <input className="form-input" id="setup-company-name" type="text" required 
              value={name} onChange={(e) => setName(e.target.value)} 
              placeholder="Ej: Mi Tiendita" />
          </div>
          
          <div className="form-group">
            <label className="form-label" htmlFor="setup-company-phone">Teléfono</label>
            <input className="form-input" id="setup-company-phone" type="tel"
              value={phone} onChange={(e) => setPhone(e.target.value)}
              placeholder="Ej: 9611234567" />
          </div>
          
          <div className="form-group">
            <label className="form-label" htmlFor="setup-company-address">Dirección</label>
            <textarea className="form-textarea" id="setup-company-address" rows="2"
              value={address} onChange={(e) => setAddress(e.target.value)}
              placeholder="Calle, Colonia, Ciudad" />
          </div>
          
          <div className="form-group">
            <label className="form-label" htmlFor="setup-company-logo-file">Logo (Opcional)</label>
            <div className="image-upload-container">
              <img id="setup-company-logo-preview" className="image-preview" src={logoPreview} alt="Preview" />
              <input className="file-input" id="setup-company-logo-file" type="file" accept="image/*"
                onChange={handleImageChange} />
            </div>
          </div>
          
          <div className="form-group">
            <label className="form-label">¿A qué se dedica tu negocio? *</label>
            
            {/* --- ¡NUEVO! --- */}
            {/* 2. Mapeamos sobre el nuevo array de objetos */}
            <div id="business-type-selection" className="business-type-container">
              {BUSINESS_RUBROS.map(rubro => (
                <div 
                  key={rubro.id}
                  className={`type-box ${selectedTypes.includes(rubro.id) ? 'selected' : ''}`}
                  onClick={() => handleTypeClick(rubro.id)}
                >
                  {rubro.label} {/* Usamos la etiqueta legible */}
                </div>
              ))}
            </div>
            {/* --- Fin de la Modificación --- */}

            {error && <p className="form-help-text validation-message error" style={{ display: 'block' }}>{error}</p>}
            <small className="form-help-text" style={{ display: 'block', marginTop: 'var(--spacing-xs)' }}>
              Selecciona al menos uno (máximo 4)
            </small>
          </div>
          
          <button type="submit" className="btn btn-save">Guardar y Empezar</button>
        </form>
      </div>
    </div>
  );
}