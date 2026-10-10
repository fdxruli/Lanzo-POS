import { Lock } from 'lucide-react';
import './EcommerceProHint.css';

export default function EcommerceProHint({
  children,
  message,
  onOpenBenefits,
  actionLabel = 'Ver beneficios',
  variant = 'inline',
  className = ''
}) {
  return (
    <div className={`ecommerce-pro-hint ecommerce-pro-hint--${variant} ${className}`.trim()} role="note">
      <Lock size={15} aria-hidden="true" />
      <span>{message || children}</span>
      {onOpenBenefits && (
        <button type="button" onClick={onOpenBenefits}>
          {actionLabel}
        </button>
      )}
    </div>
  );
}
