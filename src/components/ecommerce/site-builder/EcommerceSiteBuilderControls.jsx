import { ArrowDown, ArrowUp, RotateCcw } from 'lucide-react';

const LABELS = { header: 'Encabezado', catalog: 'Catálogo', footer: 'Pie de página' };

function Choice({ active, children, onClick }) {
  return <button type="button" className="btn btn-secondary" aria-pressed={active} onClick={onClick}>{children}</button>;
}

export default function EcommerceSiteBuilderControls({ document, disabled, onDensity, onLayout, onCatalogVisibility, onMove, onReset }) {
  const catalog = document.sections.find((section) => section.type === 'catalog');
  return (
    <section className="ecom-builder-controls" aria-labelledby="ecom-builder-controls-title">
      <div className="ecom-admin-card-heading"><div><span className="ecom-admin-eyebrow">Editor visual</span><h3 id="ecom-builder-controls-title">Diseño del sitio</h3></div></div>
      <fieldset disabled={disabled}><legend>Densidad</legend><div className="ecom-builder-choice-row"><Choice active={document.global.density === 'comfortable'} onClick={() => onDensity('comfortable')}>Cómoda</Choice><Choice active={document.global.density === 'compact'} onClick={() => onDensity('compact')}>Compacta</Choice></div></fieldset>
      {document.sections.map((section, index) => (
        <fieldset key={section.id} disabled={disabled} className="ecom-builder-section-control">
          <legend>{LABELS[section.type]}</legend>
          <div className="ecom-builder-order-actions">
            <button type="button" className="btn btn-secondary" onClick={() => onMove(section.id, 'up')} disabled={disabled || index === 0} aria-label={`Subir ${LABELS[section.type]}`}><ArrowUp size={16} />Subir</button>
            <button type="button" className="btn btn-secondary" onClick={() => onMove(section.id, 'down')} disabled={disabled || index === document.sections.length - 1} aria-label={`Bajar ${LABELS[section.type]}`}><ArrowDown size={16} />Bajar</button>
          </div>
          {section.type === 'header' ? <div className="ecom-builder-choice-row"><Choice active={section.layout === 'default'} onClick={() => onLayout('header', 'default')}>Predeterminado</Choice><Choice active={section.layout === 'showcase'} onClick={() => onLayout('header', 'showcase')}>Escaparate</Choice></div> : null}
          {section.type === 'catalog' ? <><div className="ecom-builder-choice-row"><Choice active={section.layout === 'grid'} onClick={() => onLayout('catalog', 'grid')}>Cuadrícula</Choice><Choice active={section.layout === 'compact'} onClick={() => onLayout('catalog', 'compact')}>Compacto</Choice></div><label className="ecom-builder-check"><input type="checkbox" checked={catalog.props.showSearch} onChange={(event) => onCatalogVisibility('showSearch', event.target.checked)} />Mostrar buscador</label><label className="ecom-builder-check"><input type="checkbox" checked={catalog.props.showCategories} onChange={(event) => onCatalogVisibility('showCategories', event.target.checked)} />Mostrar categorías</label></> : null}
          {section.type === 'footer' ? <p className="ecom-admin-help">El pie de página de Lanzo es obligatorio en esta versión.</p> : null}
        </fieldset>
      ))}
      <button type="button" className="btn btn-secondary" onClick={onReset} disabled={disabled}><RotateCcw size={16} />Restablecer diseño base</button>
    </section>
  );
}
