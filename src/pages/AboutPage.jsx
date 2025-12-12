// src/pages/AboutPage.jsx
import React, { useState } from 'react';
import {
  Box, WifiOff, BarChart3, ShieldCheck,
  Map, ExternalLink, MessageCircle, Bug, Lightbulb, Heart,
  Layers, Zap, Database
} from 'lucide-react';
import { useProductStore } from '../store/useProductStore';
import Logo from '../components/common/Logo';
import ContactModal from '../components/common/ContactModal';
import './AboutPage.css';

const APP_VERSION = 'v2.5.0';

const getWhatsAppLink = (type, data) => {
  const YOUR_WHATSAPP_NUMBER = import.meta.env.VITE_SUPPORT_PHONE;
  let message = '';
  if (type === 'bug') {
    message = `🚨 *Reporte de Error - Lanzo POS*\n\n*Acción:* ${data.action}\n*Error:* ${data.error}\n*Dispositivo:* ${data.device}\n`;
  } else {
    message = `💡 *Sugerencia - Lanzo POS*\n\n*Idea:* ${data.idea}\n*Beneficio:* ${data.benefit}\n`;
  }
  return `https://wa.me/${YOUR_WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;
};

export default function AboutPage() {
  const productCount = useProductStore(state => state.menu?.length || 0);
  const [modalInfo, setModalInfo] = useState({ show: false, type: '', title: '', fields: [] });

  const handleOpenModal = (type) => {
    if (type === 'bug') {
      setModalInfo({
        show: true, type: 'bug', title: 'Reportar un Problema',
        fields: [
          { id: 'action', label: '¿Qué estabas haciendo?', type: 'textarea' },
          { id: 'error', label: '¿Qué pasó? (Describe el error)', type: 'textarea' },
          { id: 'device', label: 'Tu Dispositivo', type: 'input' }
        ]
      });
    } else {
      setModalInfo({
        show: true, type: 'feature', title: 'Sugerir una Función',
        fields: [
          { id: 'idea', label: '¿Cuál es tu idea?', type: 'textarea' },
          { id: 'benefit', label: '¿Por qué sería útil?', type: 'textarea' }
        ]
      });
    }
  };

  const handleSubmitContact = (formData) => {
    window.open(getWhatsAppLink(modalInfo.type, formData), '_blank');
    setModalInfo({ show: false, type: '', title: '', fields: [] });
  };

  return (
    <div className="about-page-wrapper">

      {/* 1. HERO SECTION */}
      <section className="about-hero">
        <div className="hero-logo-wrapper">
          <Logo style={{ height: '60px', width: 'auto' }} />
        </div>
        <div className="hero-content">
          <span className="app-version">{APP_VERSION}</span>
          <h1 className="hero-slogan">El poder de un ERP, la sencillez de una App</h1>
          <p className="hero-description">
            Tienes en tus manos una herramienta profesional de gestión comercial.
            Sin suscripciones ocultas, sin dependencia de internet y diseñada para escalar contigo.
          </p>
        </div>
      </section>

      <div className="about-grid-layout">

        {/* --- COLUMNA IZQUIERDA (Funcionalidades Detalladas) --- */}
        <div className="about-col-left">

          <h3 className="section-header">¿Qué puedes hacer con Lanzo?</h3>

          {/* 2. BENTO GRID DE CARACTERÍSTICAS (Más detallado) */}
          <div className="bento-grid">

            {/* Tarjeta 1: Gestión Avanzada */}
            <div className="bento-card feature-inventory">
              <div className="bento-header">
                <div className="bento-icon"><Box size={22} /></div>
                <h4>Gestión Profesional</h4>
              </div>
              <p>
                No solo guardas productos. Creas <strong>recetas</strong> (restaurantes), gestionas <strong>tallas y colores</strong> (ropa) y controlas <strong>lotes con caducidad</strong> (farmacia/abarrotes).
              </p>
            </div>

            {/* Tarjeta 2: Offline First */}
            <div className="bento-card feature-offline">
              <div className="bento-header">
                <div className="bento-icon"><Database size={22} /></div>
                <h4>Privacidad Total (Local)</h4>
              </div>
              <p>
                Tus datos viven en <strong>este dispositivo</strong>. No en la nube de un tercero. El sistema es ultra-rápido porque no espera a internet para cobrar.
              </p>
            </div>

            {/* Tarjeta 3: Finanzas Reales */}
            <div className="bento-card feature-stats">
              <div className="bento-header">
                <div className="bento-icon"><BarChart3 size={22} /></div>
                <h4>Finanzas Reales</h4>
              </div>
              <p>
                Calculamos la <strong>utilidad neta</strong> descontando costos de insumos al momento. Sabes exactamente cuánto ganas, no solo cuánto vendes.
              </p>
            </div>

            {/* Tarjeta 4: Seguridad */}
            <div className="bento-card feature-security">
              <div className="bento-header">
                <div className="bento-icon"><ShieldCheck size={22} /></div>
                <h4>Seguridad de Datos</h4>
              </div>
              <p>
                Tú tienes el control. Exporta tus copias de seguridad en formato estándar (JSON/CSV) cuando quieras. Tu información es tuya.
              </p>
            </div>
          </div>

          {/* 3. ROADMAP (Hoja de Ruta - ACTUALIZADA) */}
          <div className="about-card roadmap-card">
            <div className="card-header-row">
              <Map size={24} className="icon-purple" />
              <h3>El Futuro de Lanzo</h3>
            </div>
            <p className="card-intro">Estamos construyendo constantemente. Esto es lo próximo en llegar:</p>

            <div className="roadmap-list">
              <div className="roadmap-item done">
                <span className="check">✓</span>
                <span>Modo Oscuro / Claro Automático</span>
              </div>
              <div className="roadmap-item done">
                <span className="check">✓</span>
                <span>Soporte para Escáner Códigos de Barras mediante tu camara</span>
              </div>
              <div className="roadmap-item done">
                <span className="check">✓</span>
                <span>Gestión de Recetas e Insumos (KDS-Restaurantes)</span>
              </div>
              <div className="roadmap-item upcoming">
                <span className="dot">○</span>
                <span>Envio de cotizaciones</span>
              </div>
              <div className="roadmap-item upcoming">
                <span className="dot">○</span>
                <span>Sincronización Multi-dispositivo (función PRO de pago)</span>
              </div>
              <div className="roadmap-item upcoming">
                <span className="dot">○</span>
                <span>Soporte para lectores de barras USB/Bluetooth (PC)</span>
              </div>
              <div className="roadmap-item upcoming">
                <span className="dot">○</span>
                <span>Soporte para impresoras termicas USB/Bluetooth (PC-Moviles)</span>
              </div>
            </div>
          </div>

        </div>

        {/* --- COLUMNA DERECHA (Social & Soporte) --- */}
        <div className="about-col-right">

          {/* 4. TARJETA PATROCINADOR PREMIUM */}
          <div className="sponsor-card-premium">
            <div className="sponsor-bg-effect"></div>
            <div className="sponsor-content">
              <div className="sponsor-header">
                <span>Impulsado por</span>
              </div>

              <h2 className="sponsor-name">Entre Alas</h2>

              {/* --- AQUÍ ESTÁ EL CAMBIO DE COPYWRITING --- */}
              <div className="sponsor-tagline" style={{ maxWidth: '450px', margin: '0 auto 2rem auto', lineHeight: '1.6' }}>
                <p style={{ margin: 0, fontSize: '1.1rem', fontWeight: '500' }}>
                  De <strong>Dark Kitchen</strong> a tu Aliado Tecnológico.
                </p>
                <p style={{ margin: '8px 0 0 0', fontSize: '0.9rem', opacity: 0.9 }}>
                  Nacimos vendiendo alitas y entendemos el reto. Por eso creamos herramientas para que nuevos emprendedores y negocios veteranos escalen sin límites.
                </p>
              </div>
              {/* ------------------------------------------- */}

              <div className="impact-counter">
                <span className="impact-label">Actualmente gestionando</span>
                <span className="impact-number">{productCount}</span>
                <span className="impact-label">productos en tu catálogo</span>
              </div>

              <a
                href="https://ea-panel.vercel.app"
                target="_blank"
                rel="noopener noreferrer"
                className="btn-visit-sponsor"
              >
                Ver nuestra web <ExternalLink size={16} />
              </a>
            </div>
          </div>

          {/* CONTACTO & SOPORTE */}
          <div className="about-card contact-card-modern">
            <h3>Tu opinión moldea el software</h3>
            <p>¿Encontraste un error o tienes una idea millonaria para una función? Cuéntanos.</p>

            <div className="contact-actions">
              <button onClick={() => handleOpenModal('bug')} className="btn-contact btn-bug">
                <Bug size={18} /> Reportar Fallo
              </button>
              <button onClick={() => handleOpenModal('feature')} className="btn-contact btn-idea">
                <Lightbulb size={18} /> Sugerir Función
              </button>
            </div>

            <div className="contact-footer">
              <small>Atención directa vía WhatsApp Entre Alas</small>
              <MessageCircle size={14} className="icon-whatsapp" />
            </div>
          </div>

        </div>
      </div>

      <ContactModal
        show={modalInfo.show}
        onClose={() => setModalInfo({ ...modalInfo, show: false })}
        onSubmit={handleSubmitContact}
        title={modalInfo.title}
        fields={modalInfo.fields}
      />
    </div>
  );
}