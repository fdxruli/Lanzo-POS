// src/components/common/LicenseChangeRequiredModal.jsx
import { ShieldAlert, KeyRound, MonitorX } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import './LicenseChangeRequiredModal.css';

const maskLicenseKey = (licenseKey = '') => {
  if (!licenseKey || typeof licenseKey !== 'string') return 'No disponible';
  if (licenseKey.length <= 8) return licenseKey;
  return `****-****-${licenseKey.slice(-8).toUpperCase()}`;
};

const getReasonCopy = (reason) => {
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

  const reason = licensePlanBlockInfo?.reason || licensePlanBlockInfo?.block_reason || 'LICENSE_PLAN_CHANGED';
  const copy = getReasonCopy(reason);

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

  return (
    <div className="license-change-screen">
      <div className="license-change-card">
        <div className="license-change-icon">
          {copy.icon}
        </div>

        <h1>{copy.title}</h1>

        <p className="license-change-main-copy">
          {serverMessage || copy.body}
        </p>

        <div className="license-change-details">
          <div>
            <span>Licencia</span>
            <strong>{maskLicenseKey(licensePlanBlockInfo?.license_key)}</strong>
          </div>

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

          {deviceRole && (
            <div>
              <span>Tipo de dispositivo bloqueado</span>
              <strong>{deviceRole === 'staff' ? 'Staff' : 'Administrador'}</strong>
            </div>
          )}
        </div>

        <div className="license-change-warning">
          <ShieldAlert size={18} />
          <span>
            No se eliminaron tus datos locales del negocio. Solo se cerró la licencia
            activa en este equipo para evitar accesos no permitidos.
          </span>
        </div>

        <button
          type="button"
          className="btn btn-primary license-change-button"
          onClick={handleChangeLicense}
        >
          <KeyRound size={19} />
          Cambiar licencia
        </button>
      </div>
    </div>
  );
}