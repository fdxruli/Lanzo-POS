import { AlertTriangle, ShieldCheck } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import './LocalTenantMismatchScreen.css';

export default function LocalTenantMismatchScreen() {
  const isolation = useAppStore((state) => state.localTenantIsolation);
  const leaveLocalTenantMismatch = useAppStore((state) => state.leaveLocalTenantMismatch);
  const isOwnershipUnresolved = [
    'LOCAL_TENANT_LEGACY_UNRESOLVED',
    'LOCAL_TENANT_STORAGE_INSPECTION_FAILED'
  ].includes(isolation?.code);

  return (
    <main className="local-tenant-block" role="alert" aria-live="assertive">
      <section className="local-tenant-block__card">
        <div className="local-tenant-block__icon" aria-hidden="true">
          {isOwnershipUnresolved ? <AlertTriangle size={38} /> : <ShieldCheck size={38} />}
        </div>
        <p className="local-tenant-block__eyebrow">Protección de datos locales</p>
        <h1>
          {isOwnershipUnresolved
            ? 'No se pudo confirmar el propietario de esta base local'
            : 'Este navegador contiene datos de otra licencia'}
        </h1>
        <p>
          Para proteger la información del negocio anterior, Lanzo no puede abrir
          esta licencia usando la base local de este navegador.
        </p>
        <p>
          {isOwnershipUnresolved
            ? 'No se borró ningún dato. Usa un perfil de navegador nuevo para esta licencia o solicita una recuperación asistida.'
            : 'No se borró ningún dato. Puedes volver a iniciar sesión con la licencia anterior o usar otro perfil de navegador.'}
        </p>
        <button
          type="button"
          className="ui-button ui-button--primary"
          onClick={leaveLocalTenantMismatch}
        >
          Volver al inicio de sesión
        </button>
      </section>
    </main>
  );
}
