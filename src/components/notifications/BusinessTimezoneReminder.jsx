import { useId } from 'react';
import { useNavigate } from 'react-router-dom';
import { ADMIN_ROUTE_PATHS } from '../../router/adminRoutePaths';

export default function BusinessTimezoneReminder({ onClose }) {
  const navigate = useNavigate();
  const titleId = useId();

  const openSettings = () => {
    onClose?.();
    navigate(`/${ADMIN_ROUTE_PATHS.settings}?tab=general`);
  };

  return (
    <section className="business-timezone-reminder" aria-labelledby={titleId}>
      <div className="business-timezone-reminder__copy">
        <h3 id={titleId}>Zona horaria pendiente</h3>
        <p>Configura la zona horaria de tu negocio. Es necesaria para algunas funciones que utilizan fechas y horarios</p>
      </div>
      <button type="button" className="ui-button ui-button--ghost" onClick={openSettings}>
        Ir a Configuración
      </button>
    </section>
  );
}
