// src/components/common/SetupModal.jsx
import React, { useState } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { compressImage } from '../../services/utils';
import LazyImage from './LazyImage';
import './SetupModal.css';

const logoPlaceholder = 'https://placehold.co/100x100/FFFFFF/4A5568?text=L';

const BUSINESS_RUBROS = [
  { id: 'food_service', label: 'Restaurante / Cocina' },
  { id: 'abarrotes', label: 'Abarrotes' },
  { id: 'farmacia', label: 'Farmacia' },
  { id: 'verduleria/fruteria', label: 'Frutería / Verdulería' },
  { id: 'apparel', label: 'Ropa / Calzado' },
  { id: 'hardware', label: 'Ferretería' },
  { id: 'otro', label: 'Otro' },
];

export default function SetupModal() {
  const handleSetup = useAppStore((state) => state.handleSetup);

  const licenseDetails = useAppStore((state) => state.licenseDetails);

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [logoPreview, setLogoPreview] = useState(logoPlaceholder);
  const [logoData, setLogoData] = useState(null); // Esto ahora guardará el FILE
  const [selectedTypes, setSelectedTypes] = useState([]);
  const [error, setError] = useState('');

  const isTrial = licenseDetails?.license_type === 'trial';
  const MAX_SELECTION = isTrial ? 1 : 4;

  const handleTypeClick = (value) => {
    setError('');
    setSelectedTypes(prev => {
      // Si ya está seleccionado, lo quitamos
      if (prev.includes(value)) {
        return prev.filter(t => t !== value);
      }

      // 3. Validamos el límite dinámico
      if (prev.length < MAX_SELECTION) {
        return [...prev, value];
      } else {
        // Feedback visual específico
        setError(isTrial
          ? "La licencia de prueba solo permite 1 rubro. Desmarca uno para cambiar."
          : `Máximo ${MAX_SELECTION} rubros permitidos.`);
        return prev;
      }
    });
  };

  const handleImageChange = async (e) => {
    const file = e.target.files[0];
    if (file) {
      try {
        const compressedFile = await compressImage(file); // 1. Llama a la nueva función

        setLogoPreview(URL.createObjectURL(compressedFile));

        setLogoData(compressedFile);

      } catch (error) {
        console.error("Error al comprimir imagen:", error);
      }
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (selectedTypes.length === 0) {
      setError('Debes seleccionar al menos un rubro.');
      return;
    }

    handleSetup({
      name,
      phone,
      address,
      logo: logoData, // Pasa el FILE object
      business_type: selectedTypes
    });
  };

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
              <LazyImage id="setup-company-logo-preview" className="image-preview" src={logoPreview} alt="Preview" />
              <input className="file-input" id="setup-company-logo-file" type="file" accept="image/*"
                onChange={handleImageChange} />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">¿A qué se dedica tu negocio? *</label>

            {isTrial && (
              <div style={{ fontSize: '0.85rem', color: 'var(--secondary-color)', marginBottom: '5px', fontWeight: '500' }}>
                ℹ️ Modo Prueba: Selecciona tu rubro principal.
              </div>
            )}

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

            {error && <p className="form-help-text validation-message error" style={{ display: 'block' }}>{error}</p>}
            <small className="form-help-text" style={{ display: 'block', marginTop: 'var(--spacing-xs)' }}>
              {isTrial ? 'Límite: 1 rubro (Versión de Prueba)' : 'Selecciona hasta 4 rubros'}
            </small>
          </div>

          <button type="submit" className="btn btn-save">Guardar y Empezar</button>
        </form>
      </div>
    </div>
  );
}