import { focusLiaValidationTarget } from './liaFormValidation';

export function LiaFieldIssue({ issue }) {
  if (!issue) return null;
  return (
    <span id={issue.id} tabIndex={-1} className={`lia-field-issue lia-field-issue--${issue.severity}`}>
      {issue.message}
    </span>
  );
}

export default function LiaFormErrorSummary({ issues = [] }) {
  const errors = issues.filter((issue) => issue.severity === 'error');
  const warnings = issues.filter((issue) => issue.severity === 'warning');
  if (!errors.length && !warnings.length) return null;

  return (
    <div className="lia-form-feedback">
      {errors.length > 0 && (
        <section className="lia-form-error-summary" role="alert" aria-labelledby="lia-form-error-title">
          <h3 id="lia-form-error-title">Hay {errors.length} {errors.length === 1 ? 'dato que debes revisar' : 'datos que debes revisar'}</h3>
          <ul>
            {errors.map((issue) => (
              <li key={issue.id}>
                <button type="button" onClick={() => focusLiaValidationTarget(issue.targetId)}>
                  <span>{issue.fieldLabel}:</span> {issue.message}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {warnings.length > 0 && (
        <section className="lia-form-warning-summary" role="note" aria-labelledby="lia-form-warning-title">
          <h3 id="lia-form-warning-title">{warnings.length === 1 ? 'Una recomendación para revisar' : `${warnings.length} recomendaciones para revisar`}</h3>
          <ul>
            {warnings.map((issue) => (
              <li key={issue.id}>
                <button type="button" onClick={() => focusLiaValidationTarget(issue.targetId)}>
                  <span>{issue.fieldLabel}:</span> {issue.message}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
