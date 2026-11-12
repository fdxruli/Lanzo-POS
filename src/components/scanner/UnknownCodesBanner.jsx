import { useId, useState } from 'react';

const ISSUE_COPY = {
  NOT_FOUND: {
    title: 'Producto no registrado',
    description: (code) => `No encontramos el código ${code} en el catálogo.`,
    action: 'Verifica el código o registra el producto desde Productos.',
  },
  DUPLICATE: {
    title: 'Código asignado a varios productos',
    description: () => 'Este código está registrado en más de un producto.',
    action: 'Corrige la asignación del código desde Productos antes de volver a escanearlo.',
  },
  INACTIVE: {
    title: 'Producto desactivado',
    description: () => 'El producto está registrado, pero actualmente no está disponible para vender.',
    action: 'Revisa su estado desde Productos.',
  },
  NO_SELLABLE_BATCH: {
    title: 'Producto sin lote disponible',
    description: () => 'El producto está registrado, pero no tiene un lote válido disponible para esta venta.',
    action: 'Revisa la disponibilidad de sus lotes desde Productos.',
  },
  ERROR: {
    title: 'No se pudo consultar el catálogo',
    description: () => 'No fue posible comprobar este código.',
    action: 'Puedes intentar escanearlo nuevamente.',
  },
};

export function UnknownCodesBanner({ issues = [], unknownCodes = [], onClear }) {
  const [expanded, setExpanded] = useState(false);
  const detailsId = useId();
  const visible = issues.length ? issues : unknownCodes.map((item) => ({
    code: item.code,
    status: 'NOT_FOUND',
  }));
  if (!visible.length) return null;

  const count = visible.length;
  return (
    <section className="scanner-issues" aria-label="Incidencias del escaneo">
      <div className="scanner-issues-summary">
        <span className="scanner-issues-indicator" aria-hidden="true">!</span>
        <span className="scanner-issues-count" role="status">
          {count === 1 ? '1 código con incidencia' : `${count} códigos requieren revisión`}
        </span>
        <button
          type="button"
          className="scanner-issues-toggle"
          aria-expanded={expanded}
          aria-controls={detailsId}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? 'Ocultar detalles' : 'Ver detalles'}
        </button>
      </div>
      <div id={detailsId} hidden={!expanded}>
        {expanded && (
          <>
            <ul className="unknown-codes-list">
              {visible.map((item) => {
                const copy = ISSUE_COPY[item.status] || ISSUE_COPY.ERROR;
                const names = (item.matches || []).map((match) => match.name).filter(Boolean);
                return (
                  <li key={`${item.code}:${item.status}`} className="unknown-badge">
                    <strong className="scanner-issue-title">{copy.title}</strong>
                    <span className="scanner-issue-code">Código: {item.code}</span>
                    <p>{copy.description(item.code)}</p>
                    {item.productName && <p>Producto: {item.productName}</p>}
                    {names.length > 0 && (
                      <p>Productos encontrados: {names.join(', ')}</p>
                    )}
                    <p className="scanner-issue-action">{copy.action}</p>
                  </li>
                );
              })}
            </ul>
            {onClear && (
              <button
                type="button"
                className="btn-clear-errors"
                onClick={() => {
                  setExpanded(false);
                  onClear();
                }}
              >
                Descartar avisos
              </button>
            )}
          </>
        )}
      </div>
    </section>
  );
}
