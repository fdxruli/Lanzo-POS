// src/components/common/SetupModal.jsx
import React, { useState } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { compressImage } from '../../services/utils'; // Importamos el compresor
import './SetupModal.css';

const logoPlaceholder = 'https://placehold.co/100x100/FFFFFF/4A5568?text=L';

export default function SetupModal() {
  // 1. Conectamos al store
  const handleSetup = useAppStore((state) => state.handleSetup);

  // 2. Estado local para el formulario
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [logoPreview, setLogoPreview] = useState(logoPlaceholder);
  const [logoData, setLogoData] = useState(null);
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

  // Lógica de compresión de imagen
  const handleImageChange = async (e) => {
    const file = e.target.files[0];
    if (file) {
      const compressed = await compressImage(file);
      setLogoPreview(compressed);
      setLogoData(compressed);
    }
  };

  // 3. Manejador de envío
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
      logo: logoData,
      business_type: selectedTypes
    });
    // El store se encargará de cambiar el 'appStatus' a 'ready'
  };

  // 4. HTML de 'business-setup-modal' traducido a JSX
  return (
    <div id="business-setup-modal" className="modal" style={{ display: 'flex' }}>
      <div className="modal-content">
        <h2>Configura tu Negocio</h2>
        <p>¡Felicidades por activar tu licencia! Ahora, personalicemos la información de tu negocio.</p>
        <form id="business-setup-form" onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label" htmlFor="setup-company-name">Nombre del Negocio</label>
            <input className="form-input" id="setup-company-name" type="text" required 
              value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="setup-company-phone">Teléfono</label>
            <input className="form-input" id="setup-company-phone" type="tel"
              value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="setup-company-address">Dirección</label>
            <textarea className="form-textarea" id="setup-company-address"
              value={address} onChange={(e) => setAddress(e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="setup-company-logo-file">Logo</label>
            <div className="image-upload-container">
              <img id="setup-company-logo-preview" className="image-preview" src={logoPreview} alt="Preview" />
              <input className="file-input" id="setup-company-logo-file" type="file" accept="image/*"
                onChange={handleImageChange} />
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">¿A qué se dedica tu negocio?</label>
            <div id="business-type-selection" className="business-type-container">
              {['farmacia', 'abarrotes', 'verduleria/fruteria', 'antojitos', 'darkitchen', 'restaurante', 'otro'].map(type => (
                <div 
                  key={type}
                  className={`type-box ${selectedTypes.includes(type) ? 'selected' : ''}`}
                  onClick={() => handleTypeClick(type)}
                >
                  {type}
                </div>
              ))}
            </div>
            {error && <p className="form-help-text validation-message error" style={{ display: 'block' }}>{error}</p>}
          </div>
          <button type="submit" className="btn btn-save">Guardar y Empezar</button>
        </form>
      </div>
    </div>
  );
}