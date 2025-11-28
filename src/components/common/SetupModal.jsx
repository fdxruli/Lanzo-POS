// src/components/common/SetupModal.jsx
import React, { useState, useMemo } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { compressImage } from '../../services/utils';
import LazyImage from './LazyImage';
import { ChevronDown, CheckCircle, Lock } from 'lucide-react'; 
import './SetupModal.css';

const logoPlaceholder = 'https://placehold.co/100x100/FFFFFF/4A5568?text=L';

const BUSINESS_RUBROS = [
  { id: 'food_service', label: 'Restaurante / Cocina', icon: '🍳' },
  { id: 'abarrotes', label: 'Abarrotes / Tienda', icon: '🛒' },
  { id: 'farmacia', label: 'Farmacia', icon: '💊' },
  { id: 'verduleria/fruteria', label: 'Frutería / Verdulería', icon: '🍎' },
  { id: 'apparel', label: 'Ropa / Calzado', icon: '👕' },
  { id: 'hardware', label: 'Ferretería', icon: '🔨' },
  { id: 'otro', label: 'Otro / General', icon: '✨' },
];

export default function SetupModal() {
  const handleSetup = useAppStore((state) => state.handleSetup);
  const licenseDetails = useAppStore((state) => state.licenseDetails);

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [logoPreview, setLogoPreview] = useState(logoPlaceholder);
  const [logoData, setLogoData] = useState(null);
  const [selectedTypes, setSelectedTypes] = useState([]);
  const [error, setError] = useState('');

  // Control del Acordeón: 'info' | 'type'
  const [activeSection, setActiveSection] = useState('info');

  // Validación robusta del tipo de licencia
  const isTrial = licenseDetails?.license_type === 'trial';
  const MAX_SELECTION = isTrial ? 1 : 4;

  // Validación del Paso 1 (Nombre obligatorio)
  const isStep1Complete = useMemo(() => name.trim().length > 0, [name]);

  const handleSectionToggle = (section) => {
    // Si intentan abrir la sección 2 sin completar la 1, no hacemos nada
    if (section === 'type' && !isStep1Complete) return; 
    setActiveSection(activeSection === section ? '' : section);
  };

  // --- LÓGICA DE SELECCIÓN CORREGIDA ---
  const handleTypeClick = (value) => {
    setError('');
    
    setSelectedTypes(prev => {
      // 1. Si ya está seleccionado, lo quitamos (Toggle Off)
      if (prev.includes(value)) {
        return prev.filter(t => t !== value);
      }

      // 2. CORRECCIÓN CRÍTICA: Si es Trial (Max 1), funciona como Radio Button (Reemplaza)
      // Esto evita que el usuario tenga que deseleccionar manualmente para cambiar.
      if (isTrial) {
        return [value];
      }

      // 3. Modo Normal: Si no hemos llegado al límite, agregamos (Checkbox behavior)
      if (prev.length < MAX_SELECTION) {
        return [...prev, value];
      }
      
      // 4. Si excedió el límite en modo normal, mostramos error
      setError(`Máximo ${MAX_SELECTION} rubros permitidos en tu plan.`);
      return prev;
    });
  };

  const handleImageChange = async (e) => {
    const file = e.target.files[0];
    if (file) {
      try {
        const compressedFile = await compressImage(file);
        setLogoPreview(URL.createObjectURL(compressedFile));
        setLogoData(compressedFile);
      } catch (error) {
        console.error("Error imagen:", error);
      }
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    
    if (selectedTypes.length === 0) {
      setError('⚠️ Debes seleccionar al menos un rubro para finalizar.');
      // Si están en el paso 1 y le dan Enter, nos aseguramos que vean el error del paso 2
      if (activeSection !== 'type') setActiveSection('type');
      return;
    }

    handleSetup({
      name,
      phone,
      address,
      logo: logoData,
      business_type: selectedTypes
    });
  };

  // Botón "Siguiente" dentro del Paso 1
  const handleContinue = (e) => {
    e.preventDefault(); 
    if (isStep1Complete) {
      setActiveSection('type');
    } else {
        // Feedback visual si intentan avanzar sin nombre
        const nameInput = document.getElementById('setup-name-input');
        if(nameInput) nameInput.focus();
    }
  };

  return (
    <div id="business-setup-modal" className="modal" style={{ display: 'flex' }}>
      <div className="modal-content setup-content">
        <div className="setup-header">
          <h2>Configura tu Negocio</h2>
          <p>Completa estos pasos para personalizar tu sistema.</p>
        </div>

        <form id="business-setup-form" onSubmit={handleSubmit}>
          
          {/* --- ACORDEÓN 1: INFORMACIÓN --- */}
          <div className={`accordion-item ${activeSection === 'info' ? 'open' : ''} ${isStep1Complete ? 'completed' : ''}`}>
            <div className="accordion-header" onClick={() => handleSectionToggle('info')}>
              <div className="header-title">
                <span className="step-number">1</span>
                <span>Información General</span>
              </div>
              <div className="header-status">
                {isStep1Complete && <CheckCircle size={20} className="icon-success" />}
                <ChevronDown size={20} className="icon-chevron" />
              </div>
            </div>

            {activeSection === 'info' && (
              <div className="accordion-body">
                <div className="form-group">
                  <label className="form-label">Nombre del Negocio *</label>
                  <input 
                    id="setup-name-input"
                    className="form-input" 
                    type="text" 
                    required
                    value={name} 
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Ej: Mi Tiendita" 
                    autoFocus 
                  />
                </div>

                <div className="form-row-split">
                  <div className="form-group">
                    <label className="form-label">Teléfono</label>
                    <input className="form-input" type="tel"
                      value={phone} onChange={(e) => setPhone(e.target.value)}
                      placeholder="Ej: 961..." />
                  </div>
                  <div className="form-group logo-group">
                    <label className="form-label">Logo</label>
                    <div className="mini-logo-upload">
                        <label htmlFor="logo-upload" className="logo-preview-wrapper">
                            <LazyImage src={logoPreview} alt="Logo" />
                            <div className="overlay">📷</div>
                        </label>
                        <input id="logo-upload" type="file" accept="image/*" 
                            onChange={handleImageChange} style={{display:'none'}} />
                    </div>
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label">Dirección</label>
                  <textarea className="form-textarea" rows="2"
                    value={address} onChange={(e) => setAddress(e.target.value)}
                    placeholder="Dirección del local..." />
                </div>

                <div className="step-actions">
                  <button 
                    type="button" 
                    className="btn btn-primary btn-next" 
                    onClick={handleContinue}
                    disabled={!isStep1Complete}
                  >
                    Continuar
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* --- ACORDEÓN 2: RUBROS (BLOQUEADO HASTA PASO 1) --- */}
          <div className={`accordion-item ${activeSection === 'type' ? 'open' : ''} ${!isStep1Complete ? 'locked' : ''}`}>
            <div className="accordion-header" onClick={() => handleSectionToggle('type')}>
              <div className="header-title">
                <span className="step-number">2</span>
                <span>Giro del Negocio</span>
              </div>
              <div className="header-status">
                {!isStep1Complete ? <Lock size={18} className="icon-locked"/> : <ChevronDown size={20} className="icon-chevron" />}
              </div>
            </div>

            {activeSection === 'type' && (
              <div className="accordion-body">
                <p className="rubro-intro">
                  Selecciona a qué se dedica tu empresa. Esto activará funciones especiales (recetas, tallas, caducidad, etc.).
                </p>

                {isTrial && (
                  <div className="trial-badge" style={{marginBottom: '10px', fontSize: '0.9rem', color: 'var(--primary-color)', backgroundColor: '#fff3cd', padding: '8px', borderRadius: '6px'}}>
                    ℹ️ <strong>Modo Prueba:</strong> Puedes seleccionar 1 rubro principal.
                  </div>
                )}

                <div className="rubro-grid">
                  {BUSINESS_RUBROS.map(rubro => (
                    <div
                      key={rubro.id}
                      className={`rubro-card ${selectedTypes.includes(rubro.id) ? 'selected' : ''}`}
                      onClick={() => handleTypeClick(rubro.id)}
                    >
                      <span className="rubro-icon">{rubro.icon}</span>
                      <span className="rubro-label">{rubro.label}</span>
                    </div>
                  ))}
                </div>

                {error && <div className="error-message">{error}</div>}

                <div className="step-actions end">
                  <button type="submit" className="btn btn-save btn-finish">
                    ¡Finalizar y Empezar! 🚀
                  </button>
                </div>
              </div>
            )}
          </div>

        </form>
      </div>
    </div>
  );
}