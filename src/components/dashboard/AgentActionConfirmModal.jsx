import React from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle,
  ClipboardList,
  MapPin,
  ShieldCheck,
  X
} from 'lucide-react';
import './AgentActionConfirmModal.css';

const PRIORITY_LABELS = {
  high: 'Alta',
  medium: 'Media',
  low: 'Baja'
};

const TYPE_LABELS = {
  navigate: 'Navegación',
  review: 'Revisión guiada',
  draft: 'Borrador',
  checklist: 'Checklist',
  manual: 'Manual'
};

export default function AgentActionConfirmModal({ action, isOpen, onClose, onConfirm }) {
  if (!isOpen || !action) return null;

  const isBlocked = action.status === 'blocked_route';
  const confirmLabel = action.canNavigate
    ? `Ir a ${action.routeLabel || action.route}`
    : 'Entendido';

  return (
    <div className="agent-action-modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="agent-action-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="agent-action-modal-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="agent-action-modal-header">
          <div className="agent-action-title-block">
            <div className="agent-action-icon-wrap">
              {isBlocked ? <AlertTriangle size={22} /> : <ShieldCheck size={22} />}
            </div>
            <div>
              <p className="agent-action-eyebrow">Acción guiada del agente</p>
              <h3 id="agent-action-modal-title">{action.label}</h3>
            </div>
          </div>
          <button className="agent-action-close" type="button" onClick={onClose} aria-label="Cerrar">
            <X size={18} />
          </button>
        </header>

        <div className={`agent-action-status ${isBlocked ? 'blocked' : 'ready'}`}>
          {isBlocked ? (
            <>
              <AlertTriangle size={16} />
              <span>Ruta bloqueada por seguridad. La recomendación queda como guía manual.</span>
            </>
          ) : action.confirmationRequired ? (
            <>
              <ShieldCheck size={16} />
              <span>Esta acción requiere confirmación antes de continuar.</span>
            </>
          ) : (
            <>
              <CheckCircle size={16} />
              <span>Acción segura para revisar.</span>
            </>
          )}
        </div>

        <section className="agent-action-details">
          <div className="agent-action-detail-row">
            <span>Tipo</span>
            <strong>{TYPE_LABELS[action.type] || TYPE_LABELS.manual}</strong>
          </div>
          <div className="agent-action-detail-row">
            <span>Prioridad</span>
            <strong>{PRIORITY_LABELS[action.priority] || PRIORITY_LABELS.medium}</strong>
          </div>
          {action.routeLabel && (
            <div className="agent-action-detail-row">
              <span>Módulo</span>
              <strong>{action.routeLabel}</strong>
            </div>
          )}
          {action.permission && (
            <div className="agent-action-detail-row">
              <span>Permiso requerido</span>
              <strong>{action.permission}</strong>
            </div>
          )}
        </section>

        {action.description && <p className="agent-action-description">{action.description}</p>}

        {(action.reason || action.expectedImpact) && (
          <section className="agent-action-reason-box">
            {action.reason && <p><strong>Por qué:</strong> {action.reason}</p>}
            {action.expectedImpact && <p><strong>Impacto esperado:</strong> {action.expectedImpact}</p>}
          </section>
        )}

        {action.steps?.length > 0 && (
          <section className="agent-action-steps">
            <h4>
              <ClipboardList size={16} />
              Pasos sugeridos
            </h4>
            <ol>
              {action.steps.map((step, index) => (
                <li key={`${action.id}-step-${index}`}>{step}</li>
              ))}
            </ol>
          </section>
        )}

        {action.route && (
          <div className="agent-action-route-preview">
            <MapPin size={14} />
            <span>{action.route}</span>
          </div>
        )}

        <footer className="agent-action-modal-footer">
          <button className="agent-action-secondary" type="button" onClick={onClose}>
            Cancelar
          </button>
          <button
            className="agent-action-primary"
            type="button"
            onClick={isBlocked ? onClose : onConfirm}
          >
            {isBlocked ? 'Cerrar' : confirmLabel}
            {!isBlocked && action.canNavigate && <ArrowRight size={16} />}
          </button>
        </footer>
      </div>
    </div>
  );
}
