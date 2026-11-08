import { useId } from 'react';
import './DashboardCustomerFilter.css';

export default function DashboardCustomerFilter({
  customers = [],
  value = null,
  onChange = () => {},
  disabledReason = ''
}) {
  const id = useId();
  const disabled = Boolean(disabledReason);

  return (
    <div className="dashboard-customer-filter">
      <label htmlFor={id}>Cliente</label>
      <div className="dashboard-customer-filter__control">
        <select
          id={id}
          value={value || ''}
          onChange={(event) => onChange(event.target.value || null)}
          disabled={disabled}
          aria-label="Cliente para estadísticas"
        >
          <option value="">Todos los clientes</option>
          {customers.map((customer) => (
            <option key={customer.id} value={String(customer.id)}>
              {customer.name || 'Cliente sin nombre'}
            </option>
          ))}
        </select>
        {value && !disabled && (
          <button
            type="button"
            className="dashboard-customer-filter__clear"
            aria-label="Quitar filtro de cliente"
            onClick={() => onChange(null)}
          >
            Quitar
          </button>
        )}
      </div>
      {disabledReason && <small className="text-muted" role="status">{disabledReason}</small>}
    </div>
  );
}
