import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { tryEnablePersistence } from '../../services/utils';
import { useAppStore } from '../../store/useAppStore';
import { ShieldCheck, ExternalLink } from 'lucide-react';
import {
  acknowledgeDataSafety,
  hasAcknowledgedDataSafety,
  isDataSafetyModalEligible,
} from '../../utils/noticePolicy';
import './DataSafetyModal.css';

const BACKUP_ROUTE = '/configuracion?tab=maintenance';

export default function DataSafetyModal() {
  const [show, setShow] = useState(false);
  const [isChecking, setIsChecking] = useState(true);
  const licenseDetails = useAppStore((state) => state.licenseDetails);
  const currentDeviceRole = useAppStore((state) => state.currentDeviceRole);
  const currentStaffUser = useAppStore((state) => state.currentStaffUser);
  const navigate = useNavigate();
  const acknowledgeButtonRef = useRef(null);

  useEffect(() => {
    let isMounted = true;

    const checkSafety = async () => {
      // 1. Intentar activar persistencia silenciosamente al cargar
      try {
        await tryEnablePersistence();

        if (!isMounted) return;

        // 2. Verificar si el usuario ya vio la advertencia
        setShow(isDataSafetyModalEligible({
          licenseDetails,
          currentDeviceRole,
          currentStaffUser,
          acknowledged: hasAcknowledgedDataSafety(),
        }));
      } finally {
        if (isMounted) setIsChecking(false);
      }
    };
    checkSafety();

    return () => {
      isMounted = false;
    };
  }, [currentDeviceRole, currentStaffUser, licenseDetails]);

  useEffect(() => {
    if (show) acknowledgeButtonRef.current?.focus();
  }, [show]);

  const handleAcknowledge = () => {
    acknowledgeDataSafety();
    setShow(false);
  };

  const handleViewBackup = () => {
    acknowledgeDataSafety();
    setShow(false);
    navigate(BACKUP_ROUTE);
  };

  if (isChecking) {
    // Evita que InstallPrompt abra una invitación durante la breve evaluación
    // asíncrona de la política de protección de datos.
    return <div data-lanzo-blocking-modal="true" data-lanzo-notice-pending="true" hidden />;
  }

  if (!show) return null;

  return (
    <div
      className="ui-modal data-safety-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="data-safety-title"
      aria-describedby="data-safety-description"
      data-lanzo-blocking-modal="true"
    >
      <div className="ui-modal__content ui-modal__content--md data-safety-modal__content">
        <div className="data-safety-modal__heading">
          <ShieldCheck className="data-safety-modal__icon" size={30} aria-hidden="true" />
          <h2 id="data-safety-title" className="ui-modal__title data-safety-modal__title">
            Protege la información de tu negocio
          </h2>
        </div>

        <div className="ui-modal__body data-safety-modal__body">
          <p id="data-safety-description">
            Lanzo puede trabajar incluso sin conexión. En esta modalidad, la información de tu negocio se conserva localmente en este dispositivo.
          </p>

          <p className="data-safety-modal__recommendations-title">Para protegerla:</p>
          <ul className="data-safety-modal__recommendations">
            <li>No uses Lanzo en modo incógnito o privado.</li>
            <li>Evita borrar los datos del sitio o del navegador de este dispositivo.</li>
            <li>Realiza respaldos periódicos de tu negocio.</li>
          </ul>

          <p className="data-safety-modal__help">
            Un respaldo actualizado te permite recuperar tu información si cambias de dispositivo o si el navegador elimina los datos locales.
          </p>
        </div>

        <div className="data-safety-modal__actions">
          <button
            ref={acknowledgeButtonRef}
            type="button"
            className="ui-button ui-button--primary data-safety-modal__action"
            onClick={handleAcknowledge}
          >
            Entendido
          </button>
          <button
            type="button"
            className="ui-button ui-button--secondary data-safety-modal__action data-safety-modal__backup-action"
            onClick={handleViewBackup}
          >
            <ExternalLink size={16} aria-hidden="true" />
            Ver cómo respaldar
          </button>
        </div>
      </div>
    </div>
  );
}
