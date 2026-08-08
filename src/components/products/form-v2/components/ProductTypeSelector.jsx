export default function ProductTypeSelector({
  title = '¿Qué estás agregando?',
  description,
  options = [],
  value,
  onChange,
  disabled = false
}) {
  if (!options.length) return null;

  return <section className="product-form-v2__type-selector" aria-labelledby="product-v2-type-selector-title">
    <div className="product-form-v2__type-selector-copy">
      <h3 id="product-v2-type-selector-title">{title}</h3>
      {description && <p>{description}</p>}
    </div>
    <div className="product-form-v2__type-options" role="radiogroup" aria-label={title} data-option-count={options.length}>
      {options.map((option) => {
        const selected = value === option.value;
        return <button
          key={option.value}
          type="button"
          className={selected ? 'is-active' : ''}
          role="radio"
          aria-checked={selected}
          disabled={disabled}
          onClick={() => onChange?.(option.value)}
        >
          {selected && <span className="product-form-v2__type-option-check" aria-hidden="true">✓</span>}
          <strong>{option.label}</strong>
        </button>;
      })}
    </div>
  </section>;
}
