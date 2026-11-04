import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAppStore } from '../../store/useAppStore';
import { syncOutboxService } from '../../services/sync/syncOutboxService';
import { getLicenseKeyFromDetails } from '../../services/sync/syncConstants';
import './CloudProtocolUpdateNotice.css';

const FAMILY_LABELS = Object.freeze({
  customer_directory: 'clientes',
  customer_credit: 'saldos de clientes',
  financial_operations: 'operaciones financieras'
});

const familyLabel = (family) => FAMILY_LABELS[family] || 'datos Cloud';

function CloudProtocolUpdateNotice({ isSuppressed = false }) {
  const licenseDetails = useAppStore((state) => state.licenseDetails);
  const licenseKey = getLicenseKeyFromDetails(licenseDetails);
  const [requiredFamilies, setRequiredFamilies] = useState(() => new Set());
  const [pausedFamilies, setPausedFamilies] = useState([]);

  const refreshPausedFamilies = useCallback(async () => {
    if (!licenseKey) {
      setPausedFamilies([]);
      return;
    }
    try {
      const summary = await syncOutboxService.getUpdateRequiredSummary({ licenseKey });
      setPausedFamilies(summary);
    } catch {
      // The live protocol event still provides the current tab's recovery state.
    }
  }, [licenseKey]);

  useEffect(() => {
    const handleUpdateRequired = (event) => {
      const family = event?.detail?.family || 'unknown';
      setRequiredFamilies((current) => new Set([...current, family]));
      refreshPausedFamilies();
    };
    const handleCompatible = (event) => {
      const family = event?.detail?.family;
      if (family) {
        setRequiredFamilies((current) => {
          const next = new Set(current);
          next.delete(family);
          return next;
        });
      }
      refreshPausedFamilies();
    };

    window.addEventListener('lanzo:cloud-protocol-update-required', handleUpdateRequired);
    window.addEventListener('lanzo:cloud-protocol-compatible', handleCompatible);
    refreshPausedFamilies();
    return () => {
      window.removeEventListener('lanzo:cloud-protocol-update-required', handleUpdateRequired);
      window.removeEventListener('lanzo:cloud-protocol-compatible', handleCompatible);
    };
  }, [refreshPausedFamilies]);

  if (isSuppressed) return null;

  const pausedCounts = new Map(pausedFamilies.map(({ family, count }) => [family, count]));
  const families = new Set([...requiredFamilies, ...pausedCounts.keys()]);
  if (families.size === 0) return null;
  const names = Array.from(families, familyLabel);
  const pendingCount = Array.from(pausedCounts.values()).reduce((sum, count) => sum + count, 0);

  return (
    <aside className="cloud-protocol-update-notice" role="status" aria-live="polite">
      <div className="cloud-protocol-update-notice__copy">
        <strong>Actualización necesaria: {names.join(', ')}</strong>
        <p>Esta versión de Lanzo POS necesita actualizarse para continuar sincronizando {names.join(' y ')} de forma segura.</p>
        {pendingCount > 0 && (
          <span>{pendingCount} operación{pendingCount === 1 ? '' : 'es'} pendiente{pendingCount === 1 ? '' : 's'} conservada{pendingCount === 1 ? '' : 's'} para recuperar.</span>
        )}
      </div>
      <Link className="cloud-protocol-update-notice__link" to="/clientes">
        Revisar clientes y pendientes
      </Link>
    </aside>
  );
}

export default CloudProtocolUpdateNotice;
