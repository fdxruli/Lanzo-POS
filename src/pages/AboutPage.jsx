// src/pages/AboutPage.jsx
import React, { useState } from 'react';
import {
  Box, BarChart3, ShieldCheck, Database,
  Map, ExternalLink, Bug, Lightbulb, Mail,
  Zap, Clock, Lock, TrendingUp
} from 'lucide-react';
import { useProductStore } from '../store/useProductStore';
import Logo from '../components/common/Logo';
import ContactModal from '../components/common/ContactModal';
import './AboutPage.css';

const APP_VERSION = `v${import.meta.env.VITE_APP_VERSION}`;
const SUPPORT_EMAIL = import.meta.env.VITE_SUPPORT_EMAIL;

// === GENERADOR DE ENLACES DE CORREO ===
const generateEmailLink = (type, formData) => {
  let subject = '';
  let body = '';

  if (type === 'bug') {
    subject = `🐛 Reporte de Error [${APP_VERSION}]`;
    body = `Hola equipo de Lanzo,

He encontrado un problema que quiero reportar:

📍 ACCIÓN QUE REALIZABA:
${formData.action || '[No especificado]'}

❌ QUÉ PASÓ (ERROR):
${formData.error || '[No especificado]'}

💻 INFORMACIÓN DEL DISPOSITIVO:
${formData.device || navigator.userAgent}

Versión de la app: ${APP_VERSION}
Fecha: ${new Date().toLocaleString()}

¡Gracias por la atención!`;
  } else {
    subject = `💡 Sugerencia de Función - Lanzo POS`;
    body = `Hola equipo,

Tengo una idea para mejorar Lanzo:

🚀 MI IDEA:
${formData.idea || '[No especificado]'}

✨ BENEFICIO:
${formData.benefit || '[No especificado]'}

📱 Información adicional:
Dispositivo: ${navigator.userAgent}
Versión: ${APP_VERSION}

¡Espero que sea útil!`;
  }

  return `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
};

export default function AboutPage() {
  const productCount = useProductStore(state => state.menu?.length || 0);
  const [contactModal, setContactModal] = useState({ 
    show: false, 
    type: '', 
    title: '', 
    fields: [],
    description: ''
  });

  // === ABRIR MODAL DE CONTACTO ===
  const handleOpenContactModal = (type) => {
    if (type === 'bug') {
      setContactModal({
        show: true,
        type: 'bug',
        title: '🐛 Reportar un Problema',
        description: 'Cuéntanos qué salió mal para poder solucionarlo rápidamente.',
        fields: [
          { 
            id: 'action', 
            label: '¿Qué estabas haciendo?', 
            type: 'textarea',
            placeholder: 'Ej: Estaba creando un nuevo producto...',
            rows: 3
          },
          { 
            id: 'error', 
            label: '¿Qué error ocurrió?', 
            type: 'textarea',
            placeholder: 'Ej: La app se cerró de repente / Apareció un mensaje de error...',
            rows: 3
          },
          { 
            id: 'device', 
            label: 'Tu dispositivo', 
            type: 'input',
            placeholder: 'Ej: iPhone 13, Android Samsung, Windows PC',
            hint: 'Esto nos ayuda a reproducir el problema'
          }
        ]
      });
    } else {
      setContactModal({
        show: true,
        type: 'feature',
        title: '💡 Sugerir una Función',
        description: 'Tus ideas nos ayudan a hacer Lanzo mejor cada día.',
        fields: [
          { 
            id: 'idea', 
            label: '¿Cuál es tu idea?', 
            type: 'textarea',
            placeholder: 'Ej: Me gustaría poder exportar reportes en PDF...',
            rows: 4
          },
          { 
            id: 'benefit', 
            label: '¿Cómo te ayudaría esto?', 
            type: 'textarea',
            placeholder: 'Ej: Podría enviar reportes a mis clientes más fácilmente...',
            rows: 3,
            hint: 'Ayúdanos a entender el valor de tu sugerencia'
          }
        ]
      });
    }
  };

  // === ENVIAR CONTACTO ===
  const handleSubmitContact = (formData) => {
    window.location.href = generateEmailLink(contactModal.type, formData);
    setContactModal({ show: false, type: '', title: '', fields: [], description: '' });
  };

  return (
    <div className="about-page-wrapper">

      {/* === HERO SECTION === */}
      <section className="about-hero">
        <div className="hero-logo-wrapper">
          <Logo style={{ height: '65px', width: 'auto' }} />
        </div>
        <span className="app-version">{APP_VERSION}</span>
        <h1 className="hero-slogan">El poder de un ERP, la sencillez de una App</h1>
        <p className="hero-description">
          Gestiona tu negocio completo desde cualquier dispositivo. Sin complicaciones, 
          sin suscripciones ocultas, sin depender de internet. <strong>Todo en tus manos.</strong>
        </p>
      </section>

      <div className="about-grid-layout">

        {/* === COLUMNA IZQUIERDA === */}
        <div className="about-col-left">
          
          <h3 className="section-header">¿Por qué elegir Lanzo?</h3>
          
          <div className="bento-grid">
            {/* Tarjeta 1 */}
            <div className="bento-card">
              <div className="bento-header">
                <div className="bento-icon"><Zap size={22} /></div>
                <h4>Rápido y Eficiente</h4>
              </div>
              <p>
                Procesa ventas, actualiza inventario y genera reportes en <strong>milisegundos</strong>. 
                Sin retrasos, sin esperas.
              </p>
            </div>

            {/* Tarjeta 2 */}
            <div className="bento-card">
              <div className="bento-header">
                <div className="bento-icon"><Lock size={22} /></div>
                <h4>100% Privado</h4>
              </div>
              <p>
                Tus datos se quedan en <strong>tu dispositivo</strong>. Sin nubes de terceros. 
                Tú tienes el control total.
              </p>
            </div>

            {/* Tarjeta 3 */}
            <div className="bento-card">
              <div className="bento-header">
                <div className="bento-icon"><Clock size={22} /></div>
                <h4>Funciona Sin Internet</h4>
              </div>
              <p>
                Vende, registra y consulta aunque no haya conexión. 
                <strong> Nunca pares tu negocio.</strong>
              </p>
            </div>

            {/* Tarjeta 4 */}
            <div className="bento-card">
              <div className="bento-header">
                <div className="bento-icon"><TrendingUp size={22} /></div>
                <h4>Reportes Inteligentes</h4>
              </div>
              <p>
                Conoce tu <strong>utilidad real</strong> con cálculos automáticos. 
                Toma decisiones basadas en datos.
              </p>
            </div>

            {/* Tarjeta 5 */}
            <div className="bento-card">
              <div className="bento-header">
                <div className="bento-icon"><Box size={22} /></div>
                <h4>Gestión Profesional</h4>
              </div>
              <p>
                Crea <strong>recetas</strong>, maneja <strong>variantes</strong> y 
                controla <strong>lotes</strong> como un verdadero ERP.
              </p>
            </div>

            {/* Tarjeta 6 */}
            <div className="bento-card">
              <div className="bento-header">
                <div className="bento-icon"><ShieldCheck size={22} /></div>
                <h4>Seguridad Garantizada</h4>
              </div>
              <p>
                Exporta tus datos cuando quieras. <strong>Copias de seguridad</strong> fáciles 
                y confiables.
              </p>
            </div>
          </div>

          {/* === ROADMAP === */}
          <div className="about-card roadmap-card">
            <div className="card-header-row">
              <Map size={24} className="icon-purple" />
              <h3>Próximas Mejoras</h3>
            </div>
            <p className="card-intro">
              Lanzo evoluciona constantemente. Esto es lo que viene:
            </p>
            <div className="roadmap-list">
              <div className="roadmap-item done">
                <span className="check">✓</span>
                <span>Modo Oscuro Automático</span>
              </div>
              <div className="roadmap-item done">
                <span className="check">✓</span>
                <span>Escáner de Códigos de Barras</span>
              </div>
              <div className="roadmap-item done">
                <span className="check">✓</span>
                <span>Sistema de Recetas (KDS)</span>
              </div>
              <div className="roadmap-item upcoming">
                <span className="dot">○</span>
                <span>Envío de Cotizaciones por Email/WhatsApp</span>
              </div>
              <div className="roadmap-item upcoming">
                <span className="dot">○</span>
                <span>Sincronización Multi-Dispositivo</span>
              </div>
              <div className="roadmap-item upcoming">
                <span className="dot">○</span>
                <span>Módulo de Empleados y Turnos</span>
              </div>
            </div>
          </div>
        </div>

        {/* === COLUMNA DERECHA === */}
        <div className="about-col-right">

          {/* === SPONSOR CARD === */}
          <div className="sponsor-card-premium">
            <div className="sponsor-bg-effect"></div>
            <div className="sponsor-content">
              <div className="sponsor-header">
                <span>Desarrollado por</span>
              </div>
              <h2 className="sponsor-name">Entre Alas</h2>
              
              <div className="sponsor-tagline">
                <p style={{ margin: 0, fontSize: '1.15rem', fontWeight: '600', lineHeight: '1.5' }}>
                  De <strong>Dark Kitchen</strong> a Aliado Tecnológico
                </p>
                <p style={{ margin: '10px 0 0 0', fontSize: '0.95rem', opacity: 0.95, lineHeight: '1.5' }}>
                  Nacimos como negocio de alimentos y creamos las herramientas que necesitábamos. 
                  Ahora las compartimos contigo.
                </p>
              </div>

              <div className="impact-counter">
                <span className="impact-label">Gestionando actualmente</span>
                <span className="impact-number">{productCount.toLocaleString()}</span>
                <span className="impact-label">productos en tu catálogo</span>
              </div>

              {/* <a 
                href="https://ea-panel.vercel.app" 
                target="_blank" 
                rel="noopener noreferrer" 
                className="btn-visit-sponsor"
              >
                Conoce nuestra historia <ExternalLink size={16} />
              </a>*/}
            </div>
          </div>

          {/* === CONTACT CARD === */}
          <div className="about-card contact-card-modern">
            <h3>Ayúdanos a mejorar</h3>
            <p style={{ marginBottom: '1.5rem', lineHeight: '1.5' }}>
              Tu opinión es valiosa. ¿Encontraste un error o tienes una idea brillante? 
              <strong> Queremos escucharte.</strong>
            </p>

            <div className="contact-actions">
              <button 
                onClick={() => handleOpenContactModal('bug')} 
                className="btn-contact btn-bug"
              >
                <Bug size={20} />
                <span>Reportar un Error</span>
              </button>
              
              <button 
                onClick={() => handleOpenContactModal('feature')} 
                className="btn-contact btn-idea"
              >
                <Lightbulb size={20} />
                <span>Sugerir Mejora</span>
              </button>
            </div>

            <div className="contact-footer">
              <Mail size={14} className="icon-email" />
              <small>Respuesta en menos de 24 horas por email</small>
            </div>
          </div>

          {/* === INFO ADICIONAL === 
          <div className="info-card">
            <h4>💼 ¿Quieres una licencia empresarial?</h4>
            <p>
              Ofrecemos planes especiales para negocios con múltiples sucursales, 
              soporte prioritario y funciones personalizadas.
            </p>
            <a 
              href={`mailto:${SUPPORT_EMAIL}?subject=Consulta Empresarial - Lanzo POS`}
              className="btn-contact-email"
            >
              <Mail size={16} />
              Contactar Ventas
            </a>
          </div>*/}

        </div>
      </div>

      {/* === MODAL DE CONTACTO === */}
      <ContactModal
        show={contactModal.show}
        onClose={() => setContactModal({ ...contactModal, show: false })}
        onSubmit={handleSubmitContact}
        title={contactModal.title}
        description={contactModal.description}
        fields={contactModal.fields}
        submitLabel="Generar Correo"
      />
    </div>
  );
}