import { useState, useEffect, useMemo } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { useActiveOrders } from '../../hooks/pos/useActiveOrders';
import { compressImage, showMessageModal } from '../../services/utils';
import Logger from '../../services/Logger';
// Se importaron nuevos iconos de lucide-react (Store, Phone, MapPin, Image, Sun, Moon, Monitor)
import { Lock, Info, FileText, Bot, Bell, Store, Phone, MapPin, Image as ImageIcon, Sun, Moon, Monitor, ShieldCheck } from 'lucide-react';
import TermsAndConditionsModal from '../common/TermsAndConditionsModal';
import { CASH_OPENING_POLICY } from '../../services/cashOpeningPolicyService.js';

const logoPlaceholder = 'https://placehold.co/100x100/FFFFFF/4A5568?text=L';

// Lógica del tema
const MQL = window.matchMedia('(prefers-color-scheme: dark)');
const applyTheme = (theme) => {
  if (theme === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
};
const getInitialTheme = () => localStorage.getItem('theme-preference') || 'system';

export default function GeneralSettings() {
  const companyProfile = useAppStore((state) => state.companyProfile);
  const updateCompanyProfile = useAppStore((state) => state.updateCompanyProfile);

  const showAssistantBot = useAppStore((state) => state.showAssistantBot);
  const setShowAssistantBot = useAppStore((state) => state.setShowAssistantBot);

  const showTicker = useAppStore((state) => state.showTicker);
  const setShowTicker = useAppStore((state) => state.setShowTicker);

  const enableMultipleOrders = useAppStore((state) => state.enableMultipleOrders);
  const setEnableMultipleOrders = useAppStore((state) => state.setEnableMultipleOrders);
  const cashOpeningPolicy = useAppStore((state) => state.cashOpeningPolicy);
  const setCashOpeningPolicy = useAppStore((state) => state.setCashOpeningPolicy);
  
  const activeOrdersCount = useActiveOrders((state) => state.activeOrders.size);

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');

  const [logoPreview, setLogoPreview] = useState(logoPlaceholder);
  const [isProcessingLogo, setIsProcessingLogo] = useState(false);
  const [activeTheme, setActiveTheme] = useState(getInitialTheme);

  const [pendingLogoFile, setPendingLogoFile] = useState(null);

  const [lockedFields, setLockedFields] = useState({
    name: false,
    phone: false,
    address: false,
    logo: false
  });

  const [showTerms, setShowTerms] = useState(false);

  useEffect(() => {
    if (companyProfile) {
      const currentName = companyProfile.name || '';
      const currentPhone = companyProfile.phone || '';
      const currentAddress = companyProfile.address || '';
      const currentLogo = companyProfile.logo || logoPlaceholder;

      setName(currentName);
      setPhone(currentPhone);
      setAddress(currentAddress);
      setLogoPreview(currentLogo);
      setPendingLogoFile(null);

      setLockedFields({
        name: !!(currentName && currentName.trim().length > 0),
        phone: !!(currentPhone && currentPhone.trim().length > 0),
        address: !!(currentAddress && currentAddress.trim().length > 0),
        logo: !!(currentLogo && !currentLogo.includes('placehold.co'))
      });
    }
  }, [companyProfile]);

  const hasChanges = useMemo(() => {
    if (!companyProfile) return false;

    const savedName = companyProfile.name || '';
    const savedPhone = companyProfile.phone || '';
    const savedAddress = companyProfile.address || '';

    const nameChanged = name.trim() !== savedName;
    const phoneChanged = phone.trim() !== savedPhone;
    const addressChanged = address.trim() !== savedAddress;
    const logoChanged = pendingLogoFile !== null;

    return nameChanged || phoneChanged || addressChanged || logoChanged;
  }, [name, phone, address, pendingLogoFile, companyProfile]);


  useEffect(() => {
    const systemThemeListener = (e) => {
      if (activeTheme === 'system') applyTheme(e.matches ? 'dark' : 'light');
    };
    MQL.addEventListener('change', systemThemeListener);

    if (activeTheme === 'system') applyTheme(MQL.matches ? 'dark' : 'light');
    else applyTheme(activeTheme);

    return () => MQL.removeEventListener('change', systemThemeListener);
  }, [activeTheme]);

  const handleThemeChange = (e) => {
    const newTheme = e.target.value;
    setActiveTheme(newTheme);
    localStorage.setItem('theme-preference', newTheme);
  };

  const handleImageChange = async (e) => {
    if (lockedFields.logo) return;

    const file = e.target.files[0];
    if (file) {
      try {
        setIsProcessingLogo(true);
        const compressedFile = await compressImage(file);
        const objectURL = URL.createObjectURL(compressedFile);

        setLogoPreview(objectURL);
        setPendingLogoFile(compressedFile);
      } catch (error) {
        Logger.error("Error imagen:", error);
      } finally {
        setIsProcessingLogo(false);
      }
    }
  };

  const updateProfileWrapper = async (updates) => {
    try {
      const currentType = companyProfile?.business_type || [];
      const dataToSave = {
        id: 'company',
        name, phone, address,
        business_type: currentType,
        ...updates
      };
      await updateCompanyProfile(dataToSave);
      setPendingLogoFile(null);
    } catch (error) {
      Logger.error(error);
      showMessageModal("Error al guardar.", null, { type: 'error' });
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const updates = { name, phone, address };
    if (pendingLogoFile) {
      updates.logo = pendingLogoFile;
    }

    await updateProfileWrapper(updates);
    showMessageModal('¡Datos actualizados correctamente! Los campos nuevos se han bloqueado.');
  };

  const InputStatusIcon = ({ isLocked }) => {
    if (!isLocked) return null;
    return (
      <span title="Bloqueado" style={{ position: 'absolute', right: '10px', top: '38px', color: '#718096' }}>
        <Lock size={16} />
      </span>
    );
  };

  return (
    <div className="company-form-container">
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        flexWrap: 'wrap',
        gap: '10px',
        marginBottom: '20px'
      }}>
        <h3 className="subtitle" style={{ margin: 0, whiteSpace: 'nowrap' }}>Datos de la Empresa</h3>

        <div style={{
          fontSize: '0.8rem',
          color: 'var(--text-light)',
          display: 'flex',
          alignItems: 'center',
          gap: '5px',
          backgroundColor: 'var(--bg-light)',
          padding: '4px 8px',
          borderRadius: '4px',
          maxWidth: '100%'
        }}>
          <Info size={14} style={{ flexShrink: 0 }} />
          <span>Los datos registrados se bloquearán al guardar. Si requiere actualizar sus datos contacte a soporte</span>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="company-form">

        <div className="settings-grid">
          {/* 1. Nombre */}
          <div className="form-group" style={{ position: 'relative' }}>
            <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Store size={16} /> Nombre del Negocio
            </label>
            <input
              type="text"
              className={`form-input ${lockedFields.name ? 'input-locked' : ''}`}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ej. Mi Tiendita"
              disabled={lockedFields.name}
              style={lockedFields.name ? { backgroundColor: '#f7fafc', cursor: 'not-allowed', color: '#718096' } : {}}
            />
            <InputStatusIcon isLocked={lockedFields.name} />
          </div>

          {/* 2. Teléfono */}
          <div className="form-group" style={{ position: 'relative' }}>
            <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Phone size={16} /> Teléfono / WhatsApp
            </label>
            <input
              type="tel"
              className={`form-input ${lockedFields.phone ? 'input-locked' : ''}`}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="Ej. 55 1234 5678"
              disabled={lockedFields.phone}
              style={lockedFields.phone ? { backgroundColor: '#f7fafc', cursor: 'not-allowed', color: '#718096' } : {}}
            />
            <InputStatusIcon isLocked={lockedFields.phone} />
          </div>

          {/* 3. Logo */}
          <div className="form-group logo-upload-group">
            <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <ImageIcon size={16} /> Logo
            </label>
            <div className={`image-upload-wrapper ${lockedFields.logo ? 'locked' : ''}`}
              style={lockedFields.logo ? { opacity: 0.7, cursor: 'not-allowed' } : {}}>

              {isProcessingLogo && (
                <div className="spinner-loader small" style={{ position: 'absolute', inset: 0, margin: 'auto' }}></div>
              )}

              <img className="image-preview" src={logoPreview} alt="Logo" />

              {lockedFields.logo && (
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.5)' }}>
                  <Lock size={24} color="#4A5568" />
                </div>
              )}

              <input
                className="file-input-hidden"
                type="file"
                accept="image/*"
                onChange={handleImageChange}
                disabled={isProcessingLogo || lockedFields.logo}
              />
            </div>
          </div>

          {/* 4. Dirección */}
          <div className="form-group full-width" style={{ position: 'relative' }}>
            <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <MapPin size={16} /> Dirección
            </label>
            <textarea
              className={`form-textarea ${lockedFields.address ? 'input-locked' : ''}`}
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              rows="2"
              placeholder="Calle, número, colonia..."
              disabled={lockedFields.address}
              style={lockedFields.address ? { backgroundColor: '#f7fafc', cursor: 'not-allowed', color: '#718096' } : {}}
            ></textarea>
            {lockedFields.address && (
              <span title="Bloqueado" style={{ position: 'absolute', right: '10px', top: '38px', color: '#718096' }}>
                <Lock size={16} />
              </span>
            )}
          </div>
        </div>

        {/* Botón Dinámico */}
        <div style={{ marginTop: '20px', display: 'flex', justifyContent: 'flex-end', height: '40px' }}>
          {hasChanges && (
            <button
              type="submit"
              className="btn btn-save animate-fade-in"
              style={{ minWidth: '150px' }}
            >
              Actualizar datos
            </button>
          )}
        </div>
      </form>

      {/* SECCIÓN APARIENCIA */}
      <div style={{ marginTop: '2.5rem', borderTop: '1px solid var(--border-color)', paddingTop: '1.5rem' }}>
        <h3 className="subtitle">Apariencia</h3>
        <div className="theme-toggle-container">
          {['light', 'dark', 'system'].map(theme => (
            <label key={theme} className="theme-radio-label">
              <input
                type="radio"
                name="theme"
                value={theme}
                checked={activeTheme === theme}
                onChange={handleThemeChange}
              />
              {/* Aquí se reemplazaron los Emojis por los Iconos de Lucide */}
              <span className="theme-radio-text" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                {theme === 'light' ? <><Sun size={16} /> Claro</> : 
                 theme === 'dark' ? <><Moon size={16} /> Oscuro</> : 
                 <><Monitor size={16} /> Sistema</>}
              </span>
            </label>
          ))}
        </div>
      </div>

      {/* SECCIÓN BARRA DE ANUNCIOS (TICKER) */}
      <div style={{ marginTop: '2.5rem', borderTop: '1px solid var(--border-color)', paddingTop: '1.5rem' }}>
        <h3 className="subtitle">Barra de Anuncios (Ticker)</h3>

        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '12px',
          backgroundColor: 'var(--bg-light)',
          borderRadius: '8px',
          border: '1px solid var(--border-color)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{
              backgroundColor: showTicker ? '#EBF8FF' : '#EDF2F7',
              padding: '8px',
              borderRadius: '50%',
              color: showTicker ? '#3182CE' : '#A0AEC0',
              transition: 'all 0.3s ease'
            }}>
              <Bell size={24} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={{ fontWeight: 500, color: 'var(--text-primary)' }}>Cinta de Notificaciones Superior</span>
              <p>Muestra alertas dinámicas en la parte superior de la pantalla.</p>
              <span style={{ fontSize: '0.85rem', color: '#E53E3E', fontWeight: 500 }}>
                ⚠️ Al desactivar esta barra dejarás de ver notificaciones críticas de stock bajo y caducidad.
              </span>
              <span style={{ fontSize: '0.85rem', color: '#E53E3E', fontWeight: 500 }}>
                Nota: Activar y desactivar este control reiniciará la animación de los mensajes en cola.
              </span>
              <br />
              <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                {showTicker ? 'La barra de anuncios está activa.' : 'La barra de anuncios está oculta.'}
              </span>
            </div>
          </div>

          {/* Toggle Switch Personalizado */}
          <label style={{
            position: 'relative',
            display: 'inline-block',
            width: '50px',
            height: '26px',
            cursor: 'pointer',
            flexShrink: 0,
            userSelect: 'none'
          }}>
            <input
              type="checkbox"
              checked={!!showTicker}
              onChange={(e) => setShowTicker(e.target.checked)}
              style={{ opacity: 0, width: 0, height: 0, position: 'absolute' }}
            />

            <span style={{
              position: 'absolute', cursor: 'pointer', top: 0, left: 0, right: 0, bottom: 0,
              backgroundColor: showTicker ? 'var(--primary-color)' : '#CBD5E0',
              transition: 'background-color .4s',
              borderRadius: '34px'
            }}></span>

            <span style={{
              position: 'absolute', content: '""', height: '20px', width: '20px',
              left: '3px',
              bottom: '3px',
              backgroundColor: 'white',
              transition: 'transform .4s',
              borderRadius: '50%',
              boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
              transform: showTicker ? 'translateX(24px)' : 'translateX(0)'
            }}></span>
          </label>
        </div>
      </div>

      {/* SECCIÓN ASISTENTE VIRTUAL */}
      <div style={{ marginTop: '2.5rem', borderTop: '1px solid var(--border-color)', paddingTop: '1.5rem' }}>
        <h3 className="subtitle">Asistente Virtual</h3>

        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '12px',
          backgroundColor: 'var(--bg-light)',
          borderRadius: '8px',
          border: '1px solid var(--border-color)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{
              backgroundColor: showAssistantBot ? '#EBF8FF' : '#EDF2F7',
              padding: '8px',
              borderRadius: '50%',
              color: showAssistantBot ? '#3182CE' : '#A0AEC0',
              transition: 'all 0.3s ease'
            }}>
              <Bot size={24} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={{ fontWeight: 500, color: 'var(--text-primary)' }}>Lanzo Bot (experimental)</span>
              <p>Estamos enseñando a nuestro BOT a ser mejor. <br/>Mientras puedes utilizarlo pero revisa los movimientos</p>
              <br />
              <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                {showAssistantBot ? 'El asistente está activo y te dará sugerencias.' : 'El asistente está desactivado.'}
              </span>
            </div>
          </div>

          {/* Toggle Switch Personalizado */}
          <label style={{
            position: 'relative',
            display: 'inline-block',
            width: '50px',
            height: '26px',
            cursor: 'pointer',
            flexShrink: 0,
            userSelect: 'none'
          }}>
            <input
              type="checkbox"
              checked={!!showAssistantBot}
              onChange={(e) => setShowAssistantBot(e.target.checked)}
              style={{ opacity: 0, width: 0, height: 0, position: 'absolute' }}
            />

            <span style={{
              position: 'absolute', cursor: 'pointer', top: 0, left: 0, right: 0, bottom: 0,
              backgroundColor: showAssistantBot ? 'var(--primary-color)' : '#CBD5E0',
              transition: 'background-color .4s',
              borderRadius: '34px'
            }}></span>

            <span style={{
              position: 'absolute', content: '""', height: '20px', width: '20px',
              left: '3px',
              bottom: '3px',
              backgroundColor: 'white',
              transition: 'transform .4s',
              borderRadius: '50%',
              boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
              transform: showAssistantBot ? 'translateX(24px)' : 'translateX(0)'
            }}></span>
          </label>
        </div>
      </div>

      {/* SECCIÓN MÚLTIPLES ÓRDENES */}
      <div style={{ marginTop: '2.5rem', borderTop: '1px solid var(--border-color)', paddingTop: '1.5rem' }}>
        <h3 className="subtitle">Múltiples Órdenes</h3>

        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '12px',
          backgroundColor: 'var(--bg-light)',
          borderRadius: '8px',
          border: '1px solid var(--border-color)',
          opacity: activeOrdersCount > 1 ? 0.7 : 1
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{
              backgroundColor: enableMultipleOrders ? '#EBF8FF' : '#EDF2F7',
              padding: '8px',
              borderRadius: '50%',
              color: enableMultipleOrders ? '#3182CE' : '#A0AEC0',
              transition: 'all 0.3s ease'
            }}>
              <FileText size={24} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={{ fontWeight: 500, color: 'var(--text-primary)' }}>Pestañas de Órdenes Simultáneas</span>
              <p>Permite atender a múltiples clientes a la vez usando pestañas (tabs).</p>
              <p> Aún en desarrollo. Revisa tus ventas despues de cerrarlas</p>
              <br />
              <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                {enableMultipleOrders ? 'Múltiples órdenes activadas.' : 'Solo se permite una orden a la vez.'}
              </span>
              {activeOrdersCount > 1 && (
                <span style={{ fontSize: '0.85rem', color: '#E53E3E', marginTop: '4px', fontWeight: 500 }}>
                  Debes cerrar, cobrar o cancelar todas las órdenes secundarias en el POS antes de desactivar esta función.
                </span>
              )}
            </div>
          </div>

          <label style={{
            position: 'relative',
            display: 'inline-block',
            width: '50px',
            height: '26px',
            cursor: activeOrdersCount > 1 ? 'not-allowed' : 'pointer',
            flexShrink: 0,
            userSelect: 'none'
          }}>
            <input
              type="checkbox"
              checked={!!enableMultipleOrders}
              onChange={(e) => {
                if (activeOrdersCount > 1) return;
                setEnableMultipleOrders(e.target.checked);
              }}
              disabled={activeOrdersCount > 1}
              style={{ opacity: 0, width: 0, height: 0, position: 'absolute' }}
            />

            <span style={{
              position: 'absolute', cursor: activeOrdersCount > 1 ? 'not-allowed' : 'pointer', top: 0, left: 0, right: 0, bottom: 0,
              backgroundColor: enableMultipleOrders ? 'var(--primary-color)' : '#CBD5E0',
              transition: 'background-color .4s',
              borderRadius: '34px',
              opacity: activeOrdersCount > 1 ? 0.6 : 1
            }}></span>

            <span style={{
              position: 'absolute', content: '""', height: '20px', width: '20px',
              left: '3px',
              bottom: '3px',
              backgroundColor: 'white',
              transition: 'transform .4s',
              borderRadius: '50%',
              boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
              transform: enableMultipleOrders ? 'translateX(24px)' : 'translateX(0)'
            }}></span>
          </label>
        </div>
      </div>

      {/* SECCIÓN LEGAL */}
      <div style={{ marginTop: '2.5rem', borderTop: '1px solid var(--border-color)', paddingTop: '1.5rem' }}>
        <h3 className="subtitle">Legal y Privacidad</h3>

        <div
          onClick={() => setShowTerms(true)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            padding: '12px',
            borderRadius: '8px',
            backgroundColor: 'var(--bg-light)',
            border: '1px solid var(--border-color)',
            cursor: 'pointer',
            transition: 'all 0.2s ease'
          }}
          onMouseEnter={(e) => e.currentTarget.style.borderColor = 'var(--primary-color)'}
          onMouseLeave={(e) => e.currentTarget.style.borderColor = 'var(--border-color)'}
        >
          <div style={{
            backgroundColor: '#EBF8FF',
            padding: '8px',
            borderRadius: '50%',
            color: '#3182CE'
          }}>
            <FileText size={20} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontWeight: 500, color: 'var(--text-primary)' }}>Términos y Condiciones de Uso</span>
            <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Consulta nuestras políticas de manejo de datos y privacidad.</span>
          </div>
        </div>
      </div>

      <div style={{ marginTop: '2.5rem', borderTop: '1px solid var(--border-color)', paddingTop: '1.5rem' }}>
        <h3 className="subtitle">Política de Caja</h3>

        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '16px',
          padding: '12px',
          backgroundColor: 'var(--bg-light)',
          borderRadius: '8px',
          border: '1px solid var(--border-color)'
        }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
            <div style={{
              backgroundColor: cashOpeningPolicy === CASH_OPENING_POLICY.AUTOMATIC ? '#FFF5D6' : '#E6FFFA',
              padding: '8px',
              borderRadius: '50%',
              color: cashOpeningPolicy === CASH_OPENING_POLICY.AUTOMATIC ? '#A36A00' : '#087F61'
            }}>
              <ShieldCheck size={24} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={{ fontWeight: 500, color: 'var(--text-primary)' }}>
                Autoapertura de caja
              </span>
              <p>
                Desactivada, exige fondo confirmado, conteo físico y empleado responsable en cada turno.
              </p>
              <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                {cashOpeningPolicy === CASH_OPENING_POLICY.AUTOMATIC
                  ? 'Activa: el sistema heredará el fondo y registrará al sistema como responsable.'
                  : 'Recomendada: ninguna caja se abre sin confirmación del operador.'}
              </span>
            </div>
          </div>

          <label style={{
            position: 'relative',
            display: 'inline-block',
            width: '50px',
            height: '26px',
            cursor: 'pointer',
            flexShrink: 0,
            userSelect: 'none'
          }}>
            <input
              type="checkbox"
              checked={cashOpeningPolicy === CASH_OPENING_POLICY.AUTOMATIC}
              onChange={(event) => setCashOpeningPolicy(
                event.target.checked
                  ? CASH_OPENING_POLICY.AUTOMATIC
                  : CASH_OPENING_POLICY.MANUAL
              )}
              style={{ opacity: 0, width: 0, height: 0, position: 'absolute' }}
              aria-label="Permitir autoapertura de caja"
            />
            <span style={{
              position: 'absolute',
              cursor: 'pointer',
              inset: 0,
              backgroundColor: cashOpeningPolicy === CASH_OPENING_POLICY.AUTOMATIC
                ? 'var(--warning-color)'
                : '#CBD5E0',
              transition: 'background-color .4s',
              borderRadius: '34px'
            }} />
            <span style={{
              position: 'absolute',
              height: '20px',
              width: '20px',
              left: '3px',
              bottom: '3px',
              backgroundColor: 'white',
              transition: 'transform .4s',
              borderRadius: '50%',
              boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
              transform: cashOpeningPolicy === CASH_OPENING_POLICY.AUTOMATIC
                ? 'translateX(24px)'
                : 'translateX(0)'
            }} />
          </label>
        </div>
      </div>

      <TermsAndConditionsModal
        isOpen={showTerms}
        onClose={() => setShowTerms(false)}
        readOnly={true}
      />
    </div>
  );
}
