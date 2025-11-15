import React from 'react';
import './DonationPage.css';
// La lógica de 'submitContactForm' de 'donation-seccion.js'
// la moveremos aquí más adelante (en el Paso 5).
// Por ahora, solo creamos la estructura visual.

export default function DonationPage() {
  
  const handleFormSubmit = (event) => {
  event.preventDefault();
  
  const formData = new FormData(event.target);
  const contact = formData.get('contact');
  const message = formData.get('message');
  
  if (!contact || !message) {
    alert('Por favor completa todos los campos.');
    return;
  }
  
  console.log('Enviando mensaje:', { contact, message });
  // TODO: Integrar con tu backend
  alert('¡Mensaje enviado! (Lógica de backend pendiente)');
  event.target.reset(); // ✅ Limpiar formulario
};

  return (
    // Reemplazamos <section> con un "Fragmento" <>
    // ya que 'Layout.jsx' ya nos da el <main>
    <>
      <div className="donation-container">
        <span className="donation-heart">❤️</span>
        <h2 className="donation-heading">¡Apoya el Crecimiento de Lanzo POS!</h2>
        <p className="donation-text">
          Tu donación nos ayuda a mantener este proyecto gratuito y en constante mejora
          para todos los emprendedores.
        </p>
        <div className="donation-buttons-container">
          <a
            href="https://www.paypal.com/invoice/p/#AXZ4W24TKCUTHQGR"
            className="donation-button"
            target="_blank"
            rel="noopener noreferrer"
            title="Donar $50 MXN a través de PayPal"
          >
            Donar $50 <span className="donation-amount">MXN (PayPal)</span>
          </a>
          <a
            href="https://pago.clip.mx/9ed1f2e2-fef2-4e68-8f0a-252ca7707289"
            target="_blank"
            rel="noopener noreferrer"
            title="Donar a través de Clip"
          >
            <img
              src="https://assets-global.website-files.com/62588b32d8d6105ab7aa9721/63bf568610f3fdf437235192_Preview.svg"
              alt="Logo Paga con Clip para donar"
            />
          </a>
        </div>
        <div className="donation-info">
          <p className="donation-info-text">
            Tu apoyo nos permite añadir nuevas funciones y mantener la plataforma
            accesible para todos.
          </p>
        </div>
        <div className="contact-container">
          <h3 className="contact-heading">Contáctanos</h3>
          <p className="contact-text">
            ¿Tienes sugerencias, dudas o necesitas una función específica? Escríbenos:
          </p>
          <div className="contact-form-container">
            {/* Aquí reemplazamos el 'action' y 'method' por el 'onSubmit' de React.
              La lógica de envío real la haremos en el Paso 5.
            */}
            <form id="contact-form" onSubmit={handleFormSubmit}>
              <div className="form-group">
                <label className="form-label" htmlFor="contact-email">Tu Correo Electrónico o Teléfono</label>
                <input
                  className="form-input"
                  id="contact-email"
                  type="text"
                  name="contact"
                  required
                  aria-required="true"
                />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="contact-message">Tu Mensaje</label>
                <textarea
                  className="form-textarea"
                  id="contact-message"
                  name="message"
                  placeholder="Ej: Me gustaría que se pudieran agrupar los productos por proveedor."
                  required
                  aria-required="true"
                ></textarea>
              </div>
              <button type="submit" className="btn btn-modal">Enviar Mensaje</button>
            </form>
            <br />
            <p>
              O si prefieres una respuesta inmediata,{' '}
              <a href="https://wa.link/dacyxv" target="_blank" rel="noopener noreferrer">
                contáctanos por WhatsApp
              </a>
              .
            </p>
          </div>
        </div>
      </div>
    </>
  );
}