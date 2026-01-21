import React from 'react';
import { MessageCircle, RefreshCw, AlertTriangle, ShieldCheck, Store, ArrowRightCircle } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import Logger from '../../services/Logger';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { 
      hasError: false, 
      error: null, 
      errorInfo: null 
    };
  }

  static getDerivedStateFromError(error) {
    // Actualiza el estado para que el siguiente renderizado muestre la interfaz de repuesto
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    // También puedes registrar el error en un servicio de reporte de errores
    Logger.error("🔥 Error crítico capturado:", error, errorInfo);
    this.setState({ errorInfo });
  }

  handleReload = () => {
    window.location.reload();
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
    // Opcional: Aquí podrías intentar limpiar partes específicas del estado global si fuera necesario
  }

  // Nueva función MEJORADA: Limpia Service Workers y Cache antes de redirigir
  // Esto soluciona el error de "Manifest Syntax Error" y la pérdida de estilos (Dark Mode)
  handleGoToPos = async () => {
    try {
      Logger.log("🧹 Iniciando limpieza de emergencia antes de ir al POS...");

      // 1. Desregistrar Service Workers (Soluciona el error del Manifest/PWA corrupto)
      if ('serviceWorker' in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        for (const registration of registrations) {
          await registration.unregister();
          Logger.log("Service Worker desregistrado.");
        }
      }

      // 2. Limpiar Caché del navegador (Asegura que se carguen los estilos y scripts frescos)
      if ('caches' in window) {
        const cacheNames = await caches.keys();
        await Promise.all(
          cacheNames.map(name => {
            Logger.log(`Borrando caché: ${name}`);
            return caches.delete(name);
          })
        );
      }
    } catch (e) {
      Logger.warn("No se pudo completar la limpieza de caché, redirigiendo de todas formas...", e);
    } finally {
      // 3. Redirigir forzando carga desde el servidor
      window.location.href = '/';
    }
  }

  handleReport = () => {
    const { error, errorInfo } = this.state;
    
    // Accedemos al estado global de forma imperativa (sin Hooks)
    const appState = useAppStore.getState();
    const companyName = appState.companyProfile?.name || 'Negocio No Configurado';
    const licenseKey = appState.licenseDetails?.license_key || 'Sin Licencia Activa';
    
    // Obtenemos el número de soporte de las variables de entorno
    const SUPPORT_PHONE = import.meta.env.VITE_SUPPORT_PHONE || ''; 
    
    // Datos técnicos del entorno
    const userAgent = navigator.userAgent;
    const platform = navigator.platform;
    const urlLocation = window.location.href;

    // Construcción del mensaje profesional
    const message = `🚨 *REPORTE DE INCIDENCIA TÉCNICA - LANZO POS*

🏢 *Negocio:* ${companyName}
🔑 *Licencia:* ${licenseKey.slice(0, 10)}...
📱 *Plataforma:* ${platform}
📍 *Ruta:* ${urlLocation}

⚠️ *Descripción del Error:*
${error ? error.toString() : 'Error desconocido'}

🕵️ *Stack Trace (Origen):*
${errorInfo ? errorInfo.componentStack.substring(0, 400) : 'No disponible'}...

📋 *User Agent:* ${userAgent}

---
*Este mensaje fue generado automáticamente por el sistema de seguridad de Lanzo.*`;

    // Abrir WhatsApp
    const whatsappUrl = `https://wa.me/${SUPPORT_PHONE}?text=${encodeURIComponent(message)}`;
    window.open(whatsappUrl, '_blank');
  }

  render() {
    if (this.state.hasError) {
      // Determinamos si el error ocurrió fuera del POS (Home) para mostrar la opción de volver
      const currentPath = window.location.pathname;
      const isPosPage = currentPath === '/' || currentPath === '';

      return (
        <div style={{ 
          minHeight: '100vh', 
          display: 'flex', 
          flexDirection: 'column', 
          justifyContent: 'center', 
          alignItems: 'center',
          backgroundColor: '#f8fafc', // Slate-50
          fontFamily: 'system-ui, -apple-system, sans-serif',
          padding: '20px'
        }}>
          
          {/* Tarjeta Principal */}
          <div style={{
            backgroundColor: 'white',
            borderRadius: '16px',
            boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
            padding: '40px',
            maxWidth: '600px',
            width: '100%',
            textAlign: 'center',
            border: '1px solid #e2e8f0'
          }}>

            {/* Icono de Alerta */}
            <div style={{ 
              backgroundColor: '#fee2e2', 
              color: '#dc2626',
              width: '80px',
              height: '80px',
              borderRadius: '50%', 
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 24px auto'
            }}>
              <AlertTriangle size={40} strokeWidth={1.5} />
            </div>

            <h2 style={{ 
              color: '#1e293b', 
              fontSize: '1.75rem', 
              fontWeight: '700',
              marginBottom: '16px',
              lineHeight: '1.2'
            }}>
              Se ha detenido la aplicación
            </h2>
            
            <p style={{ 
              color: '#475569', 
              fontSize: '1.05rem', 
              lineHeight: '1.6', 
              marginBottom: '24px' 
            }}>
              No te preocupes, <strong>no es un error tuyo</strong>. <br/>
              Ha ocurrido un problema técnico en esta sección.
            </p>

            {/* SECCIÓN NUEVA: Sugerencia de ir al POS si no estamos en él */}
            {!isPosPage && (
              <div style={{
                backgroundColor: '#eff6ff',
                border: '1px solid #bfdbfe',
                borderRadius: '12px',
                padding: '16px',
                marginBottom: '24px',
                textAlign: 'left'
              }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', marginBottom: '12px' }}>
                  <Store className="text-blue-600" size={24} style={{ minWidth: '24px' }} />
                  <div>
                    <h4 style={{ margin: '0 0 4px 0', color: '#1e40af', fontSize: '1rem' }}>
                      ¿Necesitas seguir vendiendo?
                    </h4>
                    <p style={{ margin: 0, color: '#3b82f6', fontSize: '0.9rem', lineHeight: '1.4' }}>
                      Puedes ir directamente al Punto de Venta para continuar tu trabajo. 
                      <strong style={{ display: 'block', marginTop: '4px' }}>
                        ⚠️ Por favor, evita regresar a esta sección conflictiva hasta que Soporte lo arregle. Ó intentalo mas tarde.
                      </strong>
                    </p>
                  </div>
                </div>
                
                <button
                  onClick={this.handleGoToPos}
                  style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '8px',
                    padding: '12px',
                    backgroundColor: '#2563eb', // Blue-600
                    color: 'white',
                    border: 'none',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    fontWeight: '600',
                    fontSize: '0.95rem',
                    transition: 'background-color 0.2s'
                  }}
                  onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#1d4ed8'}
                  onMouseOut={(e) => e.currentTarget.style.backgroundColor = '#2563eb'}
                >
                  <ArrowRightCircle size={18} />
                  Ir al Punto de Venta ahora
                </button>
              </div>
            )}

            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              backgroundColor: '#f0fdf4',
              border: '1px solid #bbf7d0',
              padding: '12px',
              borderRadius: '8px',
              marginBottom: '32px',
              color: '#166534',
              fontSize: '0.95rem'
            }}>
              <ShieldCheck size={20} />
              <span>Tus datos de ventas y caja están seguros.</span>
            </div>

            {/* Área de Detalle Técnico (Colapsable visualmente) */}
            <div style={{ 
              textAlign: 'left', 
              marginBottom: '32px' 
            }}>
              <label style={{ 
                fontSize: '0.85rem', 
                fontWeight: '600', 
                color: '#64748b', 
                marginBottom: '8px', 
                display: 'block' 
              }}>
                DETALLE TÉCNICO (Para soporte):
              </label>
              <div style={{ 
                backgroundColor: '#1e293b', 
                color: '#f8fafc',
                padding: '16px', 
                borderRadius: '8px', 
                fontSize: '0.85rem',
                fontFamily: 'monospace',
                overflowX: 'auto',
                maxHeight: '120px',
                border: '1px solid #334155'
              }}>
                {this.state.error && this.state.error.toString()}
              </div>
            </div>

            {/* Botones de Acción */}
            <div style={{ 
              display: 'flex', 
              flexDirection: 'column', 
              gap: '12px' 
            }}>
              
              <button 
                onClick={this.handleReport}
                style={{ 
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '10px',
                  padding: '14px 24px', 
                  borderRadius: '10px', 
                  backgroundColor: '#25D366', // WhatsApp Green
                  color: 'white', 
                  border: 'none', 
                  cursor: 'pointer', 
                  fontWeight: '600',
                  fontSize: '1rem',
                  transition: 'background-color 0.2s',
                  boxShadow: '0 4px 6px -1px rgba(37, 211, 102, 0.2)'
                }}
                onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#1ebc57'}
                onMouseOut={(e) => e.currentTarget.style.backgroundColor = '#25D366'}
              >
                <MessageCircle size={20} />
                Reportar Problema por WhatsApp
              </button>

              <div style={{ display: 'flex', gap: '12px' }}>
                <button 
                  onClick={this.handleReload}
                  style={{ 
                    flex: 1,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '8px',
                    padding: '12px', 
                    borderRadius: '10px', 
                    backgroundColor: 'white', 
                    color: '#dc2626', 
                    border: '1px solid #dc2626', 
                    cursor: 'pointer', 
                    fontWeight: '600',
                    fontSize: '0.95rem'
                  }}
                  onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#fef2f2'}
                  onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'white'}
                >
                  <RefreshCw size={18} />
                  Recargar Página
                </button>

                <button 
                  onClick={this.handleReset}
                  style={{ 
                    flex: 1,
                    padding: '12px', 
                    borderRadius: '10px', 
                    backgroundColor: 'transparent', 
                    color: '#64748b', 
                    border: '1px solid #cbd5e1', 
                    cursor: 'pointer', 
                    fontWeight: '500',
                    fontSize: '0.95rem'
                  }}
                  onMouseOver={(e) => {
                    e.currentTarget.style.borderColor = '#94a3b8';
                    e.currentTarget.style.color = '#475569';
                  }}
                  onMouseOut={(e) => {
                    e.currentTarget.style.borderColor = '#cbd5e1';
                    e.currentTarget.style.color = '#64748b';
                  }}
                >
                  Intentar recuperar
                </button>
              </div>
            </div>

          </div>
          
          <p style={{ marginTop: '24px', color: '#94a3b8', fontSize: '0.85rem' }}>
            Lanzo POS System v{import.meta.env.VITE_APP_VERSION}
          </p>
        </div>
      );
    }

    return this.props.children; 
  }
}

export default ErrorBoundary;