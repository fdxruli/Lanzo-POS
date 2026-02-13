// src/components/common/ServerStatusBanner.jsx
import { useAppStore } from '../../store/useAppStore';
import './ServerStatusBanner.css';

export default function ServerStatusBanner() {
    // Importamos la acción de cerrar
    const { serverHealth, serverMessage, dismissServerAlert } = useAppStore();

    if (serverHealth === 'ok' || !serverMessage) return null;

    const isDegraded = serverHealth === 'degraded';

    return (
        <div className={`server-status-banner ${isDegraded ? 'degraded' : 'down'}`}>
            <div className="status-icon">
                {isDegraded ? '🐢' : '🔧'}
            </div>

            <div className="status-content">
                <strong>{isDegraded ? 'Lentitud detectada' : 'Problemas con el proveedor base de datos'}</strong>
                <p>{serverMessage}</p>
                <small>No te preocupes, no es problemas tuyo o de Lanzo, puedes seguir vendiendo. Tu información se sincronizará cuando el servicio se normalice.</small>
            </div>

            {/* BOTÓN DE CERRAR (Interacción del usuario) */}
            <button
                className="banner-close-btn"
                onClick={dismissServerAlert}
                aria-label="Cerrar aviso"
            >
                ✕
            </button>
        </div>
    );
}