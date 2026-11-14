import { Link } from 'react-router-dom';
import { useActorAccess } from '../../services/auth/useActorAccess';
import { ADMIN_ROUTE_PATHS } from '../../router/adminRoutePaths';
import { LAYAWAY_TIMEZONE_MESSAGE } from '../../utils/layawayCalendar';

export default function LayawayTimezoneNotice({ onClose }) {
    const { isAdmin } = useActorAccess();
    return (
        <p role="status">
            {LAYAWAY_TIMEZONE_MESSAGE}{' '}
            {isAdmin ? (
                <Link to={`/${ADMIN_ROUTE_PATHS.settings}?tab=general`} onClick={onClose}>Ir a Configuración</Link>
            ) : 'Solicita al administrador que configure la zona horaria.'}
        </p>
    );
}
