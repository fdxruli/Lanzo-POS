document.addEventListener('DOMContentLoaded', () => {
    const customerInput = document.getElementById('sale-customer');
    const customerResults = document.getElementById('sale-customer-results');

    // Lista de clientes simulada (esto debería venir de tu base de datos o backend)
    const customers = [
        'Juan Pérez',
        'María López',
        'Carlos García',
        'Ana Martínez',
        'Luis Hernández'
    ];

    // Función para mostrar resultados filtrados
    function filterCustomers(query) {
        const filtered = customers.filter(customer => 
            customer.toLowerCase().includes(query.toLowerCase())
        );

        customerResults.innerHTML = ''; // Limpiar resultados previos

        if (filtered.length > 0) {
            filtered.forEach(customer => {
                const div = document.createElement('div');
                div.textContent = customer;
                div.classList.add('result-item');
                div.addEventListener('click', () => {
                    customerInput.value = customer;
                    customerResults.classList.add('hidden');
                });
                customerResults.appendChild(div);
            });
            customerResults.classList.remove('hidden');
        } else {
            customerResults.classList.add('hidden');
        }
    }

    // Mostrar resultados al enfocar el campo
    customerInput.addEventListener('focus', () => {
        if (customerInput.value.trim() !== '') {
            filterCustomers(customerInput.value);
        }
    });

    // Filtrar resultados mientras se escribe
    customerInput.addEventListener('input', () => {
        filterCustomers(customerInput.value);
    });

    // Ocultar resultados al hacer clic fuera del campo
    document.addEventListener('click', (event) => {
        if (!customerInput.contains(event.target) && !customerResults.contains(event.target)) {
            customerResults.classList.add('hidden');
        }
    });
});
