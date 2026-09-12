import { Link } from 'react-router-dom';
import { ShieldX } from 'lucide-react';

export default function NoPermission() {
  return (
    <div className="permission-blocker" role="alert">
      <div className="permission-blocker__icon" aria-hidden="true">
        <ShieldX size={32} />
      </div>
      <h2>No tienes permiso para acceder a esta sección</h2>
      <p>Tu sesión actual no tiene acceso a este módulo.</p>
      <Link to="/" className="btn btn-primary permission-blocker__action">
        Volver al punto de venta
      </Link>
    </div>
  );
}
