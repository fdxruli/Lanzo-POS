// src/components/common/SetupModal.jsx
import React, { useState, useMemo, useEffect } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { compressImage } from '../../services/utils';
import LazyImage from './LazyImage';
import { ChevronDown, CheckCircle, Lock, Loader2 } from 'lucide-react'; // [Modificado] Agregamos Loader2
import './SetupModal.css';
import Logger from '../../services/Logger';

const logoPlaceholder = 'https://placehold.co/100x100/FFFFFF/4A5568?text=L';

const BUSINESS_RUBROS = [
  { id: 'food_service', label: 'Restaurante / Cocina', icon: '🍳' },
  { id: 'abarrotes', label: 'Abarrotes / Tienda', icon: '🛒' },
  { id: 'farmacia', label: 'Farmacia', icon: '💊' },
  { id: 'verduleria/fruteria', label: 'Frutería / Verdulería', icon: '🍎' },
  { id: 'apparel', label: 'Ropa / Calzado', icon: '👕' },
  { id: 'hardware', label: 'Ferretería', icon: '🔨' },
];

export default function SetupModal() {
  const handleSetup = useAppStore((state) => state.handleSetup);
  const licenseDetails = useAppStore((state) => state.licenseDetails);

  // [Nuevo] Estado para controlar la carga
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    // Si la licencia NO permite todo ("*") y solo hay 1 rubro permitido...
    if (!isAllAllowed && allowedRubrosList.length === 1) {
      // ...lo seleccionamos automáticamente al cargar
      const rubroForzado = allowedRubrosList[0];
      setSelectedTypes([rubroForzado]);
    }
  }, [licenseDetails]);

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [logoPreview, setLogoPreview] = useState(logoPlaceholder);
  const [logoData, setLogoData] = useState(null);
  const [selectedTypes, setSelectedTypes] = useState([]);
  const [error, setError] = useState('');

  // Control del Acordeón: 'info' | 'type'
  const [activeSection, setActiveSection] = useState('info');

  // ============================================================
  // LÓGICA DE LICENCIA DINÁMICA (MEJORADA)
  // ============================================================
  
  const licenseFeatures = licenseDetails?.features || {};
  const maxRubrosAllowed = licenseFeatures.max_rubros || 1;
  const allowedRubrosList = licenseFeatures.allowed_rubros || ['*'];
  const isAllAllowed = allowedRubrosList.includes('*');

  // Validación del Paso 1 (Nombre obligatorio)
  const isStep1Complete = useMemo(() => name.trim().length > 0, [name]);

  const handleSectionToggle = (section) => {
    if (section === 'type' && !isStep1Complete) return; 
    setActiveSection(activeSection === section ? '' : section);
  };

  const handleTypeClick = (value) => {
    setError('');
    
    if (!isAllAllowed && !allowedRubrosList.includes(value)) {
        setError("Tu licencia no incluye acceso a este rubro específico.");
        return;
    }
    
    setSelectedTypes(prev => {
      if (prev.includes(value)) {
        return prev.filter(t => t !== value);
      }
      if (maxRubrosAllowed === 1) {
        return [value];
      }
      if (prev.length < maxRubrosAllowed) {
        return [...prev, value];
      }
      setError(`Tu licencia permite máximo ${maxRubrosAllowed} rubros.`);
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
        Logger.error("Error imagen:", error);
      }
    }
  };

  // [Modificado] Convertimos a async para manejar la espera
  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (selectedTypes.length === 0) {
      setError('⚠️ Debes seleccionar al menos un rubro para finalizar.');
      if (activeSection !== 'type') setActiveSection('type');
      return;
    }

    // Iniciamos estado de carga
    setIsSubmitting(true);
    setError(''); // Limpiar errores previos

    try {
      // Esperamos a que el store termine el proceso (subida de archivos + guardado en DB)
      await handleSetup({
        name,
        phone,
        address,
        logo: logoData,
        business_type: selectedTypes
      });
      // Nota: Si es exitoso, el appStatus cambiará en el store y este componente probablemente se desmonte.
    } catch (err) {
      Logger.error("Error en submit setup:", err);
      setError("Ocurrió un error al guardar. Intenta de nuevo.");
    } finally {
      // Si falla o termina, quitamos el loading (si el componente sigue montado)
      setIsSubmitting(false);
    }
  };

  const handleContinue = (e) => {
    e.preventDefault(); 
    if (isStep1Complete) {
      setActiveSection('type');
    } else {
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
            <div className="accordion-header" onClick={() => !isSubmitting && handleSectionToggle('info')}>
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
                    disabled={isSubmitting} // Deshabilitar inputs
                  />
                </div>

                <div className="form-row-split">
                  <div className="form-group">
                    <label className="form-label">Teléfono</label>
                    <input className="form-input" type="tel"
                      value={phone} onChange={(e) => setPhone(e.target.value)}
                      placeholder="Ej: 961..." 
                      disabled={isSubmitting}
                    />
                  </div>
                  <div className="form-group logo-group">
                    <label className="form-label">Logo</label>
                    <div className="mini-logo-upload">
                        <label htmlFor="logo-upload" className={`logo-preview-wrapper ${isSubmitting ? 'disabled' : ''}`}>
                            <LazyImage src={logoPreview} alt="Logo" />
                            {!isSubmitting && <div className="overlay">📷</div>}
                        </label>
                        <input id="logo-upload" type="file" accept="image/*" 
                            onChange={handleImageChange} style={{display:'none'}} 
                            disabled={isSubmitting}
                        />
                    </div>
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label">Dirección</label>
                  <textarea className="form-textarea" rows="2"
                    value={address} onChange={(e) => setAddress(e.target.value)}
                    placeholder="Dirección del local..." 
                    disabled={isSubmitting}
                  />
                </div>

                <div className="step-actions">
                  <button 
                    type="button" 
                    className="btn btn-primary btn-next" 
                    onClick={handleContinue}
                    disabled={!isStep1Complete || isSubmitting}
                  >
                    Continuar
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* --- ACORDEÓN 2: RUBROS --- */}
          <div className={`accordion-item ${activeSection === 'type' ? 'open' : ''} ${!isStep1Complete ? 'locked' : ''}`}>
            <div className="accordion-header" onClick={() => !isSubmitting && handleSectionToggle('type')}>
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
                  Selecciona a qué se dedica tu empresa. Esto activará funciones especiales.
                </p>

                {maxRubrosAllowed === 1 && (
                  <div className="trial-badge" style={{marginBottom: '10px', fontSize: '0.9rem', color: 'var(--primary-color)', backgroundColor: '#fff3cd', padding: '8px', borderRadius: '6px'}}>
                    ℹ️ <strong>Atención:</strong> Tu plan actual permite seleccionar <strong>1 rubro</strong> principal.
                  </div>
                )}

                <div className={`rubro-grid ${isSubmitting ? 'disabled-grid' : ''}`}>
                  {BUSINESS_RUBROS.map(rubro => {
                    const isLockedByLicense = !isAllAllowed && !allowedRubrosList.includes(rubro.id);
                    const isSelected = selectedTypes.includes(rubro.id);

                    return (
                      <div
                        key={rubro.id}
                        className={`rubro-card ${isSelected ? 'selected' : ''} ${isLockedByLicense ? 'disabled' : ''}`}
                        // Bloquear clicks si está enviando
                        onClick={() => !isLockedByLicense && !isSubmitting && handleTypeClick(rubro.id)}
                        style={isLockedByLicense || isSubmitting ? { opacity: 0.5, cursor: 'not-allowed', filter: isLockedByLicense ? 'grayscale(1)' : 'none' } : {}}
                        title={isLockedByLicense ? "No incluido en tu licencia" : ""}
                      >
                        <span className="rubro-icon">{rubro.icon}</span>
                        <span className="rubro-label">{rubro.label}</span>
                        {isLockedByLicense && <span style={{fontSize:'0.65rem', color:'var(--error-color)', marginTop:'2px'}}>Bloqueado</span>}
                      </div>
                    );
                  })}
                </div>

                {error && <div className="error-message">{error}</div>}

                <div className="step-actions end">
                  {/* [Modificado] Botón con estado de carga */}
                  <button 
                    type="submit" 
                    className="btn btn-save btn-finish"
                    disabled={isSubmitting} // Importante: Deshabilitar para evitar doble clic
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 className="animate-spin" size={20} />
                        Configurando...
                      </>
                    ) : (
                      '¡Finalizar y Empezar! 🚀'
                    )}
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