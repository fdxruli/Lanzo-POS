// src/components/dashboard/TopCustomers.jsx
import React, { useMemo } from 'react';
import { Users, Star, Phone, Crown } from 'lucide-react';
import './TopCustomers.css';

export default function TopCustomers({ customers, sales, limit = 3 }) {
  const topCustomers = useMemo(() => {
    // Calcular total comprado por cada cliente
    const customerPurchases = new Map();

    sales.forEach(sale => {
      if (sale.fulfillmentStatus === 'cancelled' || !sale.customerId || sale.customerId === 'general') return;

      // Intentar obtener los datos más actualizados del cliente
      const actualCustomer = customers?.find(c => c.id === sale.customerId);
      const customerName = actualCustomer ? actualCustomer.name : sale.customerName;

      // Ignorar ventas que no tengan un cliente real asociado o sean el "Cliente General"
      if (!customerName || customerName.toLowerCase() === 'cliente general') {
        return;
      }

      const existing = customerPurchases.get(sale.customerId) || {
        customerId: sale.customerId,
        name: customerName,
        phone: actualCustomer ? actualCustomer.phone : sale.customerPhone,
        totalSpent: 0,
        orders: 0
      };

      existing.totalSpent += Number(sale.total) || 0;
      existing.orders += 1;
      customerPurchases.set(sale.customerId, existing);
    });

    // Ordenar por total gastado y tomar los top
    return Array.from(customerPurchases.values())
      .sort((a, b) => b.totalSpent - a.totalSpent)
      .slice(0, limit);
  }, [customers, sales, limit]);

  const formatCurrency = (val) =>
    new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(val);

  if (!topCustomers || topCustomers.length === 0) {
    return (
      <div className="top-customers-empty">
        <Users size={48} strokeWidth={1.5} />
        <p>No hay clientes registrados aún</p>
        <small>Los clientes más frecuentes aparecerán aquí</small>
      </div>
    );
  }

  return (
    <div className="top-customers-container">
      <div className="top-customers-header">
        <div className="top-customers-title">
          <Star size={20} />
          <h3>Clientes Frecuentes</h3>
        </div>
      </div>

      <div className="top-customers-list">
        {topCustomers.map((customer, index) => (
          <div
            key={customer.customerId}
            className={`top-customer-item ${index === 0 ? 'top-customer-gold' : ''}`}
          >
            <div className="top-customer-avatar">
              {index === 0 ? (
                <Crown size={24} className="crown-icon" />
              ) : (
                <span className="avatar-letter">
                  {customer.name.charAt(0).toUpperCase()}
                </span>
              )}
            </div>

            <div className="top-customer-info">
              <div className="top-customer-name-row">
                <span className="top-customer-name">{customer.name}</span>
                {index === 0 && (
                  <span className="top-customer-badge">
                    <Crown size={12} /> #1
                  </span>
                )}
              </div>

              <div className="top-customer-stats">
                <span className="top-customer-stat">
                  {customer.orders} {customer.orders === 1 ? 'compra' : 'compras'}
                </span>
                <span className="top-customer-divider">•</span>
                <span className="top-customer-stat-total">
                  {formatCurrency(customer.totalSpent)}
                </span>
              </div>

              {(customer.phone) && (
                <div className="top-customer-contact">
                  {customer.phone && (
                    <a href={`tel:${customer.phone}`} className="top-customer-contact-item">
                      <Phone size={12} />
                      {customer.phone}
                    </a>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
