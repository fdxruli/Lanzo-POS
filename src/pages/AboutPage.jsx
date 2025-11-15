import React, { useState } from 'react'; // 1. Importa useState
import './AboutPage.css';
import ContactModal from '../components/common/ContactModal'; // 2. Importa el nuevo modal

// 3. Modificamos la función getWhatsAppLink
// Ahora acepta un 'tipo' y un objeto 'data' del formulario
const getWhatsAppLink = (type, data) => {
  // ==========================================================
  // ¡IMPORTANTE! Reemplaza esto con tu número de WhatsApp
  // ==========================================================
  const YOUR_WHATSAPP_NUMBER = '521122334455'; // <--- ¡CAMBIA ESTE NÚMERO!

  let message = '';
  if (type === 'bug') {
    // Usamos los datos del formulario 'data'
    message = `¡Hola! Encontré un problema en Lanzo POS:\n\n*¿Qué estaba haciendo?*\n${data.action}\n\n*¿Qué pasó?*\n${data.error}\n\n*Dispositivo:*\n${data.device}\n`;
  } else {
    // Usamos los datos del formulario 'data'
    message = `¡Hola! Tengo una sugerencia para Lanzo POS:\n\n*Mi idea es:*\n${data.idea}\n\n*¿Por qué sería útil?*\n${data.benefit}\n`;
  }
  
  const encodedMessage = encodeURIComponent(message);
  return `https://wa.me/${YOUR_WHATSAPP_NUMBER}?text=${encodedMessage}`;
};


export default function AboutPage() {
  
  // 4. Añadimos estado para controlar el modal
  const [modalInfo, setModalInfo] = useState({ 
    show: false, 
    type: '', 
    title: '', 
    fields: [] 
  });

  // 5. Función para ABRIR el modal con la info correcta
  const handleOpenModal = (type) => {
    if (type === 'bug') {
      setModalInfo({
        show: true,
        type: 'bug',
        title: 'Reportar un Problema',
        fields: [
          { id: 'action', label: '¿Qué estabas haciendo?', type: 'textarea' },
          { id: 'error', label: '¿Qué pasó? (Describe el error)', type: 'textarea' },
          { id: 'device', label: 'Tu Dispositivo (Ej: Chrome en Windows, Teléfono Android)', type: 'input' }
        ]
      });
    } else if (type === 'feature') {
      setModalInfo({
        show: true,
        type: 'feature',
        title: 'Sugerir una Función',
        fields: [
          { id: 'idea', label: '¿Cuál es tu idea?', type: 'textarea' },
          { id: 'benefit', label: '¿Por qué sería útil para tu negocio?', type: 'textarea' }
        ]
      });
    }
  };

  // 6. Función para CERRAR el modal
  const handleCloseModal = () => {
    setModalInfo({ show: false, type: '', title: '', fields: [] });
  };

  // 7. Función que se ejecuta al ENVIAR el formulario del modal
  const handleSubmitContact = (formData) => {
    const url = getWhatsAppLink(modalInfo.type, formData);
    window.open(url, '_blank'); // Abre el enlace de WhatsApp ya generado
    handleCloseModal(); // Cierra el modal
  };

  return (
    <>
      <h2 className="section-title">Acerca de Lanzo POS</h2>
      
      <div className="about-container">
        
        {/* --- TARJETA 1 (Sin cambios) --- */}
        <div className="about-card">
          <h3 className="about-heading">Software Libre para Emprendedores</h3>
          <p className="about-text">
            <strong>Lanzo POS</strong> es un sistema de punto de venta diseñado 
            con la misión de apoyar a pequeños negocios y emprendedores. 
            Creemos en el poder de las herramientas accesibles, por lo que 
            este software se distribuye de forma libre y gratuita.
          </p>
          <p className="about-text">
            Nuestro objetivo es proporcionarte una solución robusta para gestionar 
            tus ventas, inventario y clientes sin el alto costo de las licencias 
            tradicionales.
          </p>
        </div>

        {/* --- TARJETA 2 (Sin cambios) --- */}
        <div className="about-card sponsored-by">
          <h3 className="about-heading">Realizado gracias a:</h3>
          <h4 className="sponsor-name">Darkitchen "Entre Alas"</h4>
          <p className="about-text">
            El desarrollo y financiamiento de Lanzo POS es posible gracias 
            a <strong>"Entre Alas"</strong>, una dark kitchen apasionada por 
            la comida y la tecnología.
          </p>
          <p className="about-text">
            Puedes conocer más sobre su menú y concepto visitando sus redes.
          </p>
          <div className="social-links">
            <a href="https://www.facebook.com/profile.php?id=1000866462611018" className="social-link" target="_blank" rel="noopener noreferrer">
              Facebook
            </a>
            <a href="https://ea-panel.vercel.app" className="social-link" target="_blank" rel="noopener noreferrer">
            Pagina web
            </a>
          </div>
        </div>

        {/* --- TARJETA 3 (Sin cambios) --- */}
        <div className="about-card features-card">
          <h3 className="about-heading">¿Qué puedes hacer con Lanzo POS?</h3>
          <p className="about-text">
            Lanzo POS es un sistema completo diseñado para ser tu aliado en el 
            crecimiento de tu negocio. Esto es lo que puedes gestionar:
          </p>
          <ul className="features-list">
            <li>Gestiona un Punto de Venta rápido y eficiente.</li>
            <li>Controla tu inventario, productos, costos y caducidades.</li>
            <li>Administra tu cartera de Clientes y sus historiales de compra.</li>
            <li>Lleva un registro de Cajas, con aperturas, cierres y movimientos.</li>
            <li>Revisa tus Ventas y Estadísticas para tomar mejores decisiones.</li>
            <li>Escanea códigos de barras para vender y agregar productos.</li>
            <li>Maneja ventas a crédito (fiado) y registra abonos fácilmente.</li>
            <li>Personaliza la información de tu negocio y el tema (claro/oscuro).</li>
          </ul>
        </div>

        {/* --- TARJETA DE CONTACTO (MODIFICADA) --- */}
        <div className="about-card contact-card">
          <h3 className="about-heading">Contacto y Soporte</h3>
          <p className="about-text">
            ¿Encontraste un error? ¿Tienes una idea para una nueva función? 
            ¡Tu opinión es vital para mejorar Lanzo POS!
          </p>
          <p className="about-text">
            Completa un breve formulario y te ayudaremos a generar el mensaje 
            para enviar por WhatsApp:
          </p>
          <div className="contact-buttons">
            {/* 8. Cambiamos <a> por <button> */}
            <button
              onClick={() => handleOpenModal('bug')} 
              className="contact-button bug-report" 
            >
              Reportar un Problema
            </button>
            <button
              onClick={() => handleOpenModal('feature')} 
              className="contact-button feature-request" 
            >
              Sugerir una Función
            </button>
          </div>
        </div>
      </div>

      {/* 9. Renderizamos el modal (estará oculto hasta que 'show' sea true) */}
      <ContactModal
        show={modalInfo.show}
        onClose={handleCloseModal}
        onSubmit={handleSubmitContact}
        title={modalInfo.title}
        fields={modalInfo.fields}
      />
    </>
  );
}