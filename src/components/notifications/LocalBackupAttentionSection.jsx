import { DatabaseBackup } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export default function LocalBackupAttentionSection({ attention, onClose }) {
  const navigate = useNavigate();
  if (!attention?.ready || !attention.condition) return null;
  const { condition, record } = attention;
  const read = record?.readStates?.includes(condition.key);
  return (
    <section className={`local-backup-attention is-${condition.severity}`} aria-labelledby="local-backup-attention-title">
      <div className="local-backup-attention__heading">
        <DatabaseBackup size={20} aria-hidden="true" />
        <div>
          <p className="local-backup-attention__eyebrow">Protección de datos / Respaldos</p>
          <h3 id="local-backup-attention-title">{condition.title}</h3>
        </div>
      </div>
      <p>{condition.detail}</p>
      {condition.active && (
        <p className="local-backup-attention__state">
          {read ? 'Leída · la atención sigue pendiente.' : 'Pendiente de revisar.'}
        </p>
      )}
      <div className="local-backup-attention__actions">
        <button type="button" className="ui-button ui-button--secondary" onClick={() => {
          if (!attention.update('read', condition.key)) return;
          onClose();
          navigate(condition.route);
        }}>{condition.action}</button>
        {condition.active && !read && (
          <button type="button" className="ui-button ui-button--ghost" onClick={() => attention.update('read', condition.key)}>
            Marcar como leída
          </button>
        )}
      </div>
    </section>
  );
}
