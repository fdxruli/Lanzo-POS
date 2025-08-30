// donation-section.js
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
    
    /**
     * Función para mostrar mensajes modales (se mantiene aquí por dependencia)
     * Esta función debería estar en un archivo de utilidades comunes
     */
    const showMessageModal = (message, onConfirm = null) => {
        const messageModal = document.getElementById('message-modal');
        const modalMessage = document.getElementById('modal-message');
        const closeModalBtn = document.getElementById('close-modal-btn');
        
        if (!modalMessage || !messageModal || !closeModalBtn) return;
        
        modalMessage.textContent = message;
        messageModal.classList.remove('hidden');
        
        const originalText = closeModalBtn.textContent;
        const confirmMode = typeof onConfirm === 'function';
        
        if (confirmMode) {
            closeModalBtn.textContent = 'Sí, continuar';
        } else {
            closeModalBtn.textContent = 'Aceptar';
        }
        
        closeModalBtn.onclick = () => {
            messageModal.classList.add('hidden');
            if (confirmMode) onConfirm();
            closeModalBtn.textContent = 'Aceptar';
        };
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