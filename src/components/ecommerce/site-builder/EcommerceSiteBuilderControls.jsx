import { ArrowDown, ArrowUp, RotateCcw } from 'lucide-react';

const LABELS = { header: 'Encabezado', catalog: 'Catálogo', footer: 'Pie de página' };
const LAYOUTS = { default: 'Predeterminado', showcase: 'Escaparate', grid: 'Cuadrícula', compact: 'Compacto' };

function Choice({ active, children, onClick }) {
  return <button type="button" className="btn btn-secondary ecom-builder-segmented__option" aria-pressed={active} onClick={onClick}>{children}</button>;
}

export default function EcommerceSiteBuilderControls({ document, disabled, mode = 'structure', onDensity, onLayout, onCatalogVisibility, onMove, onReset }) {
  const catalog = document.sections.find((section) => section.type === 'catalog');
  if (mode === 'catalog') return (
    <section className="ecom-builder-controls" aria-label="Presentación del catálogo">
      <details className="ecom-builder-fold">
        <summary><span><strong>Presentación del catálogo</strong><small>{LAYOUTS[catalog?.layout] || 'Cuadrícula'} · {catalog?.props.showSearch ? 'Con buscador' : 'Sin buscador'} · {document.global.density === 'compact' ? 'Densidad compacta' : 'Densidad cómoda'}</small></span></summary>
        <div className="ecom-builder-fold__body">
          <fieldset disabled={disabled} className="ecom-builder-section-control">
            <legend>Presentación</legend>
            <div className="ecom-builder-segmented">
              <Choice active={catalog?.layout === 'grid'} onClick={() => onLayout('catalog', 'grid')}>Cuadrícula</Choice>
              <Choice active={catalog?.layout === 'compact'} onClick={() => onLayout('catalog', 'compact')}>Compacto</Choice>
            </div>
          </fieldset>
          <fieldset disabled={disabled} className="ecom-builder-section-control">
            <legend>Elementos visibles</legend>
            <div className="ecom-builder-visibility-list">
              <label className="ecom-builder-check"><input type="checkbox" checked={catalog?.props.showSearch === true} onChange={(event) => onCatalogVisibility('showSearch', event.target.checked)} />Mostrar buscador</label>
              <label className="ecom-builder-check"><input type="checkbox" checked={catalog?.props.showCategories === true} onChange={(event) => onCatalogVisibility('showCategories', event.target.checked)} />Mostrar categorías</label>
            </div>
          </fieldset>
          <fieldset disabled={disabled} className="ecom-builder-section-control">
            <legend>Densidad general</legend>
            <div className="ecom-builder-segmented">
              <Choice active={document.global.density === 'comfortable'} onClick={() => onDensity('comfortable')}>Cómoda</Choice>
              <Choice active={document.global.density === 'compact'} onClick={() => onDensity('compact')}>Compacta</Choice>
            </div>
          </fieldset>
        </div>
      </details>
    </section>
  );

  return (
    <section className="ecom-builder-controls" aria-label="Estructura de la tienda">
      <details className="ecom-builder-fold">
        <summary><span><strong>Estructura de la tienda</strong><small>{document.sections.map((section) => LABELS[section.type]).join(' · ')}</small></span></summary>
        <div className="ecom-builder-fold__body">
          <p className="ecom-admin-help">Organiza las secciones con Subir y Bajar. El pie de página permanece obligatorio.</p>
          {document.sections.map((section, index) => (
            <details className="ecom-builder-section-row" key={section.id}>
              <summary><span><strong>{LABELS[section.type]}</strong><small>{LAYOUTS[section.layout] || 'Obligatorio'} · Posición {index + 1}</small></span></summary>
              <div className="ecom-builder-section-row__body">
                <fieldset disabled={disabled} className="ecom-builder-section-control">
                  <legend>Orden</legend>
                  <div className="ecom-builder-order-actions ecom-builder-segmented">
                    <button type="button" className="btn btn-secondary ecom-builder-segmented__option" onClick={() => onMove(section.id, 'up')} disabled={disabled || index === 0} aria-label={'Subir ' + LABELS[section.type]}><ArrowUp size={16} />Subir</button>
                    <button type="button" className="btn btn-secondary ecom-builder-segmented__option" onClick={() => onMove(section.id, 'down')} disabled={disabled || index === document.sections.length - 1} aria-label={'Bajar ' + LABELS[section.type]}><ArrowDown size={16} />Bajar</button>
                  </div>
                </fieldset>
                {section.type === 'header' && <fieldset disabled={disabled} className="ecom-builder-section-control">
                  <legend>Encabezado</legend>
                  <div className="ecom-builder-segmented">
                    <Choice active={section.layout === 'default'} onClick={() => onLayout('header', 'default')}>Predeterminado</Choice>
                    <Choice active={section.layout === 'showcase'} onClick={() => onLayout('header', 'showcase')}>Escaparate</Choice>
                  </div>
                </fieldset>}
                {section.type === 'catalog' && <p className="ecom-admin-help">El estilo, buscador y categorías se configuran en Presentación del catálogo.</p>}
                {section.type === 'footer' && <p className="ecom-admin-help">El pie de página de Lanzo es obligatorio en esta versión.</p>}
              </div>
            </details>
          ))}
          <button type="button" className="btn btn-secondary ecom-builder-reset" onClick={onReset} disabled={disabled}><RotateCcw size={16} />Restablecer diseño base</button>
        </div>
      </details>
    </section>
  );
}
