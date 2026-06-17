import { Link } from 'react-router-dom';
import { ShieldX } from 'lucide-react';

export default function NoPermission() {
  return (
    <div className="permission-blocker" role="alert">
      <div className="permission-blocker__icon" aria-hidden="true">
        <ShieldX size={32} />
      </div>
      <h2>No tienes permiso para acceder a esta seccion</h2>
      <p>Tu usuario staff no tiene habilitado este modulo.</p>
      <Link to="/" className="btn btn-primary permission-blocker__action">
        Volver al punto de venta
      </Link>
    </div>
  );
}
