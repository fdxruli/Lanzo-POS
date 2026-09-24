// src/components/common/LicenseChangeRequiredModal.jsx
import { ShieldAlert, KeyRound, MonitorX, RotateCcw } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import './LicenseChangeRequiredModal.css';

const maskLicenseKey = (licenseKey = '') => {
  if (!licenseKey || typeof licenseKey !== 'string') return 'No disponible';
  if (licenseKey.length <= 8) return licenseKey;
  return `****-****-${licenseKey.slice(-8).toUpperCase()}`;
};

const isFreeOwnerRecovery = (info = {}) => (
  (info.reason || info.block_reason) === 'PLAN_DOWNGRADE_DEVICE_LIMIT' &&
  String(info.plan_code || '').trim().toLowerCase() === 'free_trial' &&
  Number(info.max_devices) === 1
);

const getReasonCopy = (reason, recoveryAvailable) => {
  if (recoveryAvailable) {
    return {
      icon: <MonitorX size={42} />,
      title: 'Tu plan cambió a Lanzo Local',
      body:
        'Este equipo quedó fuera del único dispositivo activo de Lanzo Local. ' +
        'Tus datos del negocio no se borraron. El propietario puede elegir usar este dispositivo.'
    };
  }

  switch (reason) {
    case 'PLAN_DOWNGRADE_STAFF_NOT_INCLUDED':
      return {
        icon: <MonitorX size={42} />,
        title: 'Este dispositivo staff ya no está permitido',
        body:
          'La licencia fue cambiada a un plan que no incluye usuarios staff. ' +
          'Por seguridad, esta sesión fue bloqueada automáticamente.'
      };

    case 'PLAN_DOWNGRADE_DEVICE_LIMIT':
      return {
        icon: <MonitorX size={42} />,
        title: 'Este dispositivo excede el límite del nuevo plan',
        body:
          'La licencia fue cambiada a un plan con menos dispositivos permitidos. ' +
          'Este equipo quedó fuera del límite y fue bloqueado automáticamente.'
      };

    default:
      return {
        icon: <ShieldAlert size={42} />,
        title: 'La licencia cambió de plan',
        body:
          'El servidor actualizó las condiciones de esta licencia. ' +
          'Para continuar, debes ingresar una licencia compatible con este dispositivo.'
      };
  }
};

export default function LicenseChangeRequiredModal() {
  const licensePlanBlockInfo = useAppStore((state) => state.licensePlanBlockInfo);
  const confirmLicenseChangeRequired = useAppStore((state) => state.confirmLicenseChangeRequired);
  const recoverDowngradedOwnerDevice = useAppStore((state) => state.recoverDowngradedOwnerDevice);

  const reason = licensePlanBlockInfo?.reason || licensePlanBlockInfo?.block_reason || 'LICENSE_PLAN_CHANGED';
  const recoveryAvailable = isFreeOwnerRecovery(licensePlanBlockInfo);
  const copy = getReasonCopy(reason, recoveryAvailable);

  const planName =
    licensePlanBlockInfo?.plan_name ||
    licensePlanBlockInfo?.planName ||
    'Plan actual';

  const productName =
    licensePlanBlockInfo?.product_name ||
    licensePlanBlockInfo?.productName ||
    'Lanzo POS';

  const maxDevices =
    licensePlanBlockInfo?.max_devices ??
    licensePlanBlockInfo?.maxDevices ??
    null;

  const deviceRole =
    licensePlanBlockInfo?.device_role ||
    licensePlanBlockInfo?.deviceRole ||
    null;

  const serverMessage = licensePlanBlockInfo?.message;

  const handleChangeLicense = async () => {
    await confirmLicenseChangeRequired();
  };

  const handleRecoverDevice = () => {
    recoverDowngradedOwnerDevice?.();
  };

  return (
    <div
      className="license-change-screen"
      role="dialog"
      aria-modal="true"
      aria-labelledby="license-change-title"
      aria-describedby="license-change-description"
    >
      <div className="license-change-card">
        <div className="license-change-icon" aria-hidden="true">
          {copy.icon}
        </div>

        <h1 id="license-change-title">{copy.title}</h1>

        <p id="license-change-description" className="license-change-main-copy">
          {recoveryAvailable ? copy.body : serverMessage || copy.body}
        </p>

        <div className="license-change-details">
          {!recoveryAvailable && (
            <div>
              <span>Licencia</span>
              <strong>{maskLicenseKey(licensePlanBlockInfo?.license_key)}</strong>
            </div>
          )}

          <div>
            <span>Producto</span>
            <strong>{productName}</strong>
          </div>

          <div>
            <span>Plan actual</span>
            <strong>{planName}</strong>
          </div>

          {maxDevices !== null && (
            <div>
              <span>Dispositivos permitidos</span>
              <strong>{maxDevices}</strong>
            </div>
          )}

          {deviceRole && !recoveryAvailable && (
            <div>
              <span>Tipo de dispositivo bloqueado</span>
              <strong>{deviceRole === 'staff' ? 'Staff' : 'Administrador'}</strong>
            </div>
          )}
        </div>

        <div className="license-change-warning" role="note">
          <ShieldAlert size={18} aria-hidden="true" />
          <span>
            {recoveryAvailable
              ? 'Para recuperar este equipo se pedirán las credenciales del propietario. No se cerrará ninguna caja.'
              : 'No se eliminaron tus datos locales del negocio. Solo se cerró la licencia activa en este equipo para evitar accesos no permitidos.'}
          </span>
        </div>

        {recoveryAvailable && (
          <button
            type="button"
            className="btn btn-primary license-change-button"
            onClick={handleRecoverDevice}
            autoFocus
          >
            <RotateCcw size={19} aria-hidden="true" />
            Recuperar este dispositivo
          </button>
        )}

        <button
          type="button"
          className={recoveryAvailable ? 'btn btn-cancel license-change-button' : 'btn btn-primary license-change-button'}
          onClick={handleChangeLicense}
        >
          <KeyRound size={19} aria-hidden="true" />
          Cambiar licencia
        </button>
      </div>
    </div>
  );
}
