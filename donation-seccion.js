import { showMessageModal } from './utils.js';

document.addEventListener('DOMContentLoaded', () => {
    console.log('donation-section.js: DOMContentLoaded event fired.');
    
    // --- ELEMENTOS DEL DOM PARA LA SECCIÓN DE DONACIÓN ---
    const donationSection = document.getElementById('donation-section');
    const contactForm = document.getElementById('contact-form');
    
    // --- FUNCIONES ESPECÍFICAS DE DONACIÓN ---
    
    /**
     * Función para enviar el formulario de contacto
     */
    const submitContactForm = async (e) => {
        if (!contactForm) return;
        
        e.preventDefault();
        const formData = new FormData(contactForm);
        
        try {
            const response = await fetch('https://api.web3forms.com/submit', {
                method: 'POST',
                body: formData
            });
            
            const result = await response.json();
            
            if (result.success) {
                showMessageModal('¡Mensaje enviado con éxito! Nos pondremos en contacto pronto.');
                contactForm.reset();
            } else {
                showMessageModal('Error al enviar el mensaje: ' + (result.message || 'Por favor, intenta de nuevo.'));
            }
        } catch (error) {
            console.error('Error submitting contact form:', error.message);
            showMessageModal('Error al enviar el mensaje: ' + error.message);
        }
    };
    
    // --- EVENT LISTENERS PARA LA SECCIÓN DE DONACIÓN ---
    if (contactForm) {
        contactForm.addEventListener('submit', submitContactForm);
    }
    
    console.log('Donation section initialized successfully');
});

// Función para inicializar la sección de donación desde app.js
export function initializeDonationSection() {
    // Esta función se llama desde app.js después de que el DOM esté listo
    console.log('Initializing donation section');
    
    // Los event listeners ya están configurados en el DOMContentLoaded de este archivo
    // Aquí podrías agregar cualquier inicialización adicional necesaria
}