import React, { useState, useEffect } from 'react';
import { saveData, loadData, saveBulk, STORES, archiveOldData } from '../services/database';
import { compressImage } from '../services/utils';
import { useAppStore } from '../store/useAppStore';
import { useStatsStore } from '../store/useStatsStore';
import DeviceManager from '../components/common/DeviceManager';
import './SettingsPage.css';

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

const MQL = window.matchMedia('(prefers-color-scheme: dark)');

const applyTheme = (theme) => {
  if (theme === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
};

const getInitialTheme = () => {
  return localStorage.getItem('theme-preference') || 'system';
};

export default function SettingsPage() {
  const [isProcessingLogo, setIsProcessingLogo] = useState(false);
  const companyProfile = useAppStore((state) => state.companyProfile);
  const licenseDetails = useAppStore((state) => state.licenseDetails);
  const updateCompanyProfile = useAppStore((state) => state.updateCompanyProfile);
  const logout = useAppStore((state) => state.logout);

  const loadStats = useStatsStore((state) => state.loadStats);

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');

  const [businessType, setBusinessType] = useState([]);

  // --- LÓGICA DINÁMICA DE LICENCIA ---
  const licenseFeatures = licenseDetails?.features || {};
  const maxRubrosAllowed = licenseFeatures.max_rubros || 1;
  const allowedRubrosList = licenseFeatures.allowed_rubros || ['*'];
  const isAllAllowed = allowedRubrosList.includes('*');

  const [logoPreview, setLogoPreview] = useState(logoPlaceholder);
  const [logoData, setLogoData] = useState(null);
  const [activeTheme, setActiveTheme] = useState(getInitialTheme);
  const [logoObjectURL, setLogoObjectURL] = useState(null);

  useEffect(() => {
    if (companyProfile) {
      setName(companyProfile.name || 'Lanzo Negocio');
      setPhone(companyProfile.phone || '');
      setAddress(companyProfile.address || '');

      let types = companyProfile.business_type || [];
      if (typeof types === 'string') {
        types = types.split(',').map(s => s.trim());
      }
      setBusinessType(types);

      setLogoPreview(companyProfile.logo || logoPlaceholder);
      setLogoData(companyProfile.logo || null);
    }
  }, [companyProfile]);

  useEffect(() => {
    return () => {
      if (logoObjectURL) {
        URL.revokeObjectURL(logoObjectURL);
      }
    };
  }, [logoObjectURL]);

  useEffect(() => {
    const systemThemeListener = (e) => {
      if (activeTheme === 'system') {
        applyTheme(e.matches ? 'dark' : 'light');
      }
    };
    MQL.addEventListener('change', systemThemeListener);
    return () => {
      MQL.removeEventListener('change', systemThemeListener);
    };
  }, [activeTheme]);

  // --- HANDLER ACTUALIZADO CON BLOQUEO ESTRICTO ---
  const handleRubroToggle = (rubroId) => {
    // 1. Validar si el rubro está permitido específicamente por la licencia (ej: Solo Farmacias)
    if (!isAllAllowed && !allowedRubrosList.includes(rubroId)) {
      alert("Tu licencia actual no permite seleccionar este rubro.");
      return;
    }

    // 2. BLOQUEO ESTRICTO PARA TRIAL (Max 1)
    // Si la licencia solo permite 1 rubro Y ya tenemos uno seleccionado...
    // El usuario NO puede cambiarlo ni quitarlo. Debe contactar a soporte.
    if (maxRubrosAllowed === 1 && businessType.length > 0) {
      // Si intenta tocar el que ya tiene seleccionado
      if (businessType.includes(rubroId)) {
        alert("🔒 El rubro está bloqueado por tu licencia de prueba. No puedes deseleccionarlo.");
      } else {
        // Si intenta tocar otro
        alert("🔒 Tu licencia de prueba está vinculada al rubro seleccionado inicialmente. Contáctanos para cambiarlo.");
      }
      return;
    }

    // 3. Comportamiento normal (Multirubro o primera selección)
    setBusinessType(prev => {
      if (prev.includes(rubroId)) {
        return prev.filter(id => id !== rubroId);
      } else {
        if (prev.length >= maxRubrosAllowed) {
          alert(`Has alcanzado el límite de ${maxRubrosAllowed} rubros permitidos por tu licencia.`);
          return prev;
        }
        return [...prev, rubroId];
      }
    });
  };

  const handleImageChange = async (e) => {
    const file = e.target.files[0];
    if (file) {
      setIsProcessingLogo(true);
      try {
        if (logoObjectURL) URL.revokeObjectURL(logoObjectURL);
        const compressedFile = await compressImage(file);
        const objectURL = URL.createObjectURL(compressedFile);
        setLogoObjectURL(objectURL);
        setLogoPreview(objectURL);
        setLogoData(compressedFile);
      } catch (error) {
        console.error("Error imagen:", error);
      } finally {
        setIsProcessingLogo(false);
      }
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const companyData = {
        id: 'company',
        name: name,
        phone: phone,
        address: address,
        logo: logoData,
        business_type: businessType
      };

      await updateCompanyProfile(companyData);
      alert('¡Configuración guardada! Los formularios se han actualizado.');

    } catch (error) {
      console.error("Error al guardar configuración:", error);
      alert('Hubo un error al guardar.');
    }
  };

  const handleThemeChange = (e) => {
    const newTheme = e.target.value;
    setActiveTheme(newTheme);
    localStorage.setItem('theme-preference', newTheme);
    if (newTheme === 'system') {
      applyTheme(MQL.matches ? 'dark' : 'light');
    } else {
      applyTheme(newTheme);
    }
  }

  const handleRecalculateProfits = async () => {
    if (!window.confirm("⚠️ ¿Deseas recalcular todas las ventas usando los COSTOS ACTUALES de tus productos?\n\nEsto corregirá las ganancias negativas causadas por errores de importación, pero sobrescribirá el historial de costos.")) {
      return;
    }

    try {
      const [sales, products] = await Promise.all([
        loadData(STORES.SALES),
        loadData(STORES.MENU)
      ]);

      const productCostMap = new Map();
      products.forEach(p => productCostMap.set(p.id, parseFloat(p.cost) || 0));

      let updatedCount = 0;

      const updatedSales = sales.map(sale => {
        let saleModified = false;
        if (sale.fulfillmentStatus === 'cancelled') return sale;

        const newItems = sale.items.map(item => {
          const realId = item.parentId || item.id;
          const currentCost = productCostMap.get(realId);

          if (currentCost !== undefined) {
            const oldCost = parseFloat(item.cost) || 0;
            if (Math.abs(oldCost - currentCost) > 0.01) {
              saleModified = true;
              return { ...item, cost: currentCost };
            }
          }
          return item;
        });

        if (saleModified) {
          updatedCount++;
          return { ...sale, items: newItems };
        }
        return sale;
      });

      if (updatedCount > 0) {
        await saveBulk(STORES.SALES, updatedSales);
        await loadStats(true);
        alert(`✅ Reparación completada.\nSe actualizaron ${updatedCount} ventas.`);
      } else {
        alert("No se encontraron discrepancias.");
      }

    } catch (error) {
      console.error(error);
      alert("Error al recalcular: " + error.message);
    }
  };

  const handleSyncStock = async () => {
    if (!window.confirm("⚠️ ¿Deseas sincronizar el stock visible en el POS con la suma real de tus lotes?\n\nEsto corregirá los productos que dicen 'AGOTADO' pero tienen lotes activos.")) {
      return;
    }

    setIsProcessingLogo(true); // Usamos el loader existente para bloquear UI
    try {
      // 1. Cargar todos los productos y lotes
      const [allBatches, allProducts] = await Promise.all([
        loadData(STORES.PRODUCT_BATCHES),
        loadData(STORES.MENU)
      ]);

      // 2. Calcular la suma real de stock por producto
      const realStockMap = {};

      allBatches.forEach(batch => {
        // Solo sumamos lotes que estén marcados como activos y tengan stock positivo
        if (batch.isActive && batch.stock > 0) {
          const currentSum = realStockMap[batch.productId] || 0;
          realStockMap[batch.productId] = currentSum + batch.stock;
        }
      });

      // 3. Comparar y preparar actualizaciones
      const updates = [];
      let updatedCount = 0;

      allProducts.forEach(product => {
        // Si el producto usa gestión de lotes (o debería usarla porque tiene lotes)
        const calculatedStock = realStockMap[product.id] || 0;
        const currentStock = product.stock || 0;

        // Detectamos discrepancia (tolerancia de 0.01 por decimales)
        if (Math.abs(currentStock - calculatedStock) > 0.01) {
          // Si el producto tiene lotes pero tracking desactivado, lo activamos
          const shouldTrack = calculatedStock > 0 || product.trackStock;

          updates.push({
            ...product,
            stock: calculatedStock,
            trackStock: shouldTrack,
            updatedAt: new Date().toISOString()
          });
          updatedCount++;
        }
      });

      // 4. Guardar cambios
      if (updates.length > 0) {
        await saveBulk(STORES.MENU, updates);
        alert(`✅ Sincronización completada.\nSe corrigió el stock de ${updatedCount} productos.`);
        // Forzar recarga de estadísticas si es necesario
        await loadStats(true);
      } else {
        alert("✅ El inventario ya está perfectamente sincronizado.");
      }

    } catch (error) {
      console.error(error);
      alert("Error al sincronizar: " + error.message);
    } finally {
      setIsProcessingLogo(false);
    }
  };

  const renderLicenseInfo = () => {
    if (!licenseDetails || !licenseDetails.valid) {
      return <p>No hay una licencia activa.</p>;
    }
    const { license_key, product_name, expires_at, max_devices } = licenseDetails;
    const statusText = 'Activa y Verificada';

    return (
      <div className="license-info-container">
        <div className="license-info">
          <div className="license-detail">
            <span className="license-label">Clave:</span>
            <span className="license-value">{license_key || 'N/A'}</span>
          </div>
          <div className="license-detail">
            <span className="license-label">Producto:</span>
            <span className="license-value">{product_name || 'N/A'}</span>
          </div>
          <div className="license-detail">
            <span className="license-label">Expira:</span>
            <span className="license-value">{expires_at ? new Date(expires_at).toLocaleDateString() : 'Nunca'}</span>
          </div>
          <div className="license-detail">
            <span className="license-label">Estado:</span>
            <span className="license-status-active">{statusText}</span>
          </div>
          <div className="license-detail">
            <span className="license-label">Límite de Dispositivos:</span>
            <span className="license-value">{max_devices || 'N/A'}</span>
          </div>
          <div className="license-detail">
            <span className="license-label">Límite de Rubros:</span>
            <span className="license-value">{maxRubrosAllowed === 999 ? 'Ilimitado' : maxRubrosAllowed}</span>
          </div>
        </div>

        <h4 className="device-manager-title">Dispositivos Activados</h4>
        <DeviceManager licenseKey={license_key} />

        <button
          id="delete-license-btn"
          className="btn btn-cancel"
          style={{ width: 'auto', marginTop: '1rem' }}
          onClick={logout}
        >
          Desactivar en este dispositivo
        </button>
      </div>
    );
  };

  const handleArchive = async () => {
    if (!confirm("Esto descargará y BORRARÁ las ventas de hace más de 6 meses para acelerar el sistema. ¿Continuar?")) return;

    try {
      const oldSales = await archiveOldData(6); // 6 meses

      if (oldSales.length > 0) {
        // Descargar archivo
        const blob = new Blob([JSON.stringify(oldSales)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `ARCHIVO_LANZO_HISTORICO_${new Date().toISOString()}.json`;
        a.click();

        alert(`✅ Se archivaron y limpiaron ${oldSales.length} ventas.`);
      } else {
        alert("No hay ventas antiguas para archivar.");
      }
    } catch (error) {
      console.error(error);
      alert("Error al archivar.");
    }
  };

  return (
    <>
      <div className="company-form-container">
        <h3 className="subtitle">Datos de la Empresa</h3>
        <form id="company-form" className="company-form" onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label" htmlFor="company-name">Nombre del Negocio</label>
            <input
              className="form-input"
              id="company-name"
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled
            />
            <small className="form-help-text">
              Para cambiar el nombre, contacta a soporte.
            </small>
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="company-phone">Teléfono de Contacto</label>
            <input
              className="form-input"
              id="company-phone"
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              disabled
            />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="company-address">Dirección del Negocio</label>
            <textarea
              className="form-textarea"
              id="company-address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
            ></textarea>
          </div>

          <div className="form-group">
            <label className="form-label">Rubros del Negocio (Selecciona múltiples)</label>

            {/* Mensaje de Bloqueo */}
            {maxRubrosAllowed === 1 && (
              <p style={{ fontSize: '0.9rem', color: 'var(--primary-color)', marginBottom: '10px', backgroundColor: '#eff6ff', padding: '10px', borderRadius: '6px', borderLeft: '4px solid var(--primary-color)' }}>
                ℹ️ <strong>Modo Prueba Activado:</strong> El rubro está vinculado a tu licencia y no se puede cambiar aquí.
              </p>
            )}

            <div className="rubro-selector-grid">
              {BUSINESS_RUBROS.map(rubro => {
                // Verificar si está permitido por la licencia (General)
                const isNotAllowedByLicense = !isAllAllowed && !allowedRubrosList.includes(rubro.id);

                // Verificar si está "Bloqueado" por la regla de Max 1 (Trial)
                // Si el límite es 1 y ya hay selección, TODO está bloqueado visualmente (excepto el seleccionado que se ve activo pero no clickeable)
                const isTrialLocked = maxRubrosAllowed === 1 && businessType.length > 0;

                // Si está seleccionado, se ve verde. Si no, y está locked, se ve gris.
                const isSelected = businessType.includes(rubro.id);

                return (
                  <div
                    key={rubro.id}
                    className={`rubro-box ${isSelected ? 'selected' : ''}`}
                    onClick={() => handleRubroToggle(rubro.id)}
                    style={{
                      // Opacidad visual:
                      // Si no está permitido -> 0.5
                      // Si es trial locked y NO es el seleccionado -> 0.5 (gris)
                      opacity: (isNotAllowedByLicense || (isTrialLocked && !isSelected)) ? 0.5 : 1,

                      // Cursor:
                      // Si hay bloqueo -> not-allowed
                      cursor: (isNotAllowedByLicense || isTrialLocked) ? 'not-allowed' : 'pointer',

                      position: 'relative'
                    }}
                    title={isTrialLocked ? "Bloqueado por licencia de prueba" : ""}
                  >
                    {rubro.label}
                    {/* Candado si está bloqueado por cualquiera de las dos razones */}
                    {(isNotAllowedByLicense || (isTrialLocked && !isSelected)) && (
                      <span style={{ position: 'absolute', top: 2, right: 5, fontSize: '0.9rem' }}>🔒</span>
                    )}
                    {/* Candado VERDE si es el seleccionado en modo trial (indicando que es fijo) */}
                    {(isTrialLocked && isSelected) && (
                      <span style={{ position: 'absolute', top: 2, right: 5, fontSize: '0.9rem' }}>🔒</span>
                    )}
                  </div>
                );
              })}
            </div>
            <small className="form-help-text">
              Esto adaptará los formularios de productos a tus necesidades.
            </small>
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="company-logo-file">Logo del Negocio</label>
            <div className="image-upload-container" style={{ position: 'relative', width: 'fit-content' }}>
              {isProcessingLogo && (
                <div style={{
                  position: 'absolute', inset: 0, background: 'rgba(255,255,255,0.7)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 5, borderRadius: '8px'
                }}>
                  <div className="spinner-loader small"></div>
                </div>
              )}
              <img
                id="company-logo-preview"
                className="image-preview"
                src={logoPreview}
                alt="Vista previa del logo"
              />
              <input
                className="file-input"
                id="company-logo-file"
                type="file"
                accept="image/*"
                onChange={handleImageChange}
                disabled={isProcessingLogo}
              />
            </div>
          </div>
          <button type="submit" className="btn btn-save">Guardar Cambios</button>
        </form>

        <h3 className="subtitle">Tema de la Aplicación</h3>
        <div className="theme-toggle-container" role="radiogroup" aria-label="Seleccionar tema">
          <label className="theme-radio-label">
            <input type="radio" name="theme" value="light" checked={activeTheme === 'light'} onChange={handleThemeChange} />
            <span className="theme-radio-text">Claro</span>
          </label>
          <label className="theme-radio-label">
            <input type="radio" name="theme" value="dark" checked={activeTheme === 'dark'} onChange={handleThemeChange} />
            <span className="theme-radio-text">Oscuro</span>
          </label>
          <label className="theme-radio-label">
            <input type="radio" name="theme" value="system" checked={activeTheme === 'system'} onChange={handleThemeChange} />
            <span className="theme-radio-text">Por Defecto</span>
          </label>
        </div>

        <h3 className="subtitle">Licencia del Software</h3>
        {renderLicenseInfo()}

        <div className="backup-container" style={{ marginTop: '2rem', borderTop: '2px dashed var(--warning-color)', padding: '20px', backgroundColor: '#fff7ed' }}>
          <h3 className="subtitle" style={{ color: '#c2410c', marginTop: 0, borderBottom: 'none' }}>
            🔧 Mantenimiento del Sistema
          </h3>
          <p style={{ fontSize: '0.9rem', color: '#9a3412', marginBottom: '20px' }}>
            Utiliza estas herramientas avanzadas para corregir inconsistencias en los datos.
            <br /><strong>Recomendación:</strong> Haz una copia de seguridad antes de usarlas.
          </p>

          <div className="maintenance-grid">

            {/* HERRAMIENTA 1: REPARAR GANANCIAS */}
            <div className="maintenance-tool-card">
              <div className="tool-info">
                <h4>📊 Recalcular Reportes</h4>
                <p>
                  Usa esto si ves <strong>ganancias negativas</strong> o costos en cero.
                  Reconstruye el historial de ventas basado en el costo actual de los productos.
                </p>
              </div>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleRecalculateProfits}
                style={{ backgroundColor: '#ea580c', border: 'none' }}
              >
                🔄 Reparar Ganancias
              </button>
            </div>

            {/* HERRAMIENTA 2: SINCRONIZAR STOCK */}
            <div className="maintenance-tool-card">
              <div className="tool-info">
                <h4>📦 Sincronizar Inventario</h4>
                <p>
                  Usa esto si el Punto de Venta dice <strong>"AGOTADO"</strong> pero tienes lotes disponibles.
                  Suma el stock real de todos los lotes y actualiza el catálogo.
                </p>
              </div>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleSyncStock}
                style={{ backgroundColor: '#2563eb', border: 'none' }}
              >
                🧩 Sincronizar Stock
              </button>
            </div>

            <div className="maintenance-tool-card" style={{ borderColor: '#7c3aed' }}>
              <div className="tool-info">
                <h4 style={{ color: '#7c3aed' }}>🗄️ Archivar Historial</h4>
                <p>
                  Mejora la velocidad del sistema. Descarga un respaldo y <strong>elimina</strong> las ventas antiguas (más de 6 meses) de este dispositivo.
                </p>
              </div>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleArchive}
                style={{ backgroundColor: '#7c3aed', border: 'none', color: 'white' }}
              >
                📦 Archivar y Limpiar
              </button>
            </div>

          </div>
        </div>

      </div>
    </>
  );
}