import { ChevronDown } from 'lucide-react';

export default function ProductFormAccordion({ id, title, description, summary, isOpen, onToggle, children }) {
  const contentId = `${id}-content`;
  return (
    <section className={`product-form-v2__accordion ${isOpen ? 'is-open' : ''}`}>
      <button type="button" className="product-form-v2__accordion-trigger" aria-expanded={isOpen} aria-controls={contentId} onClick={onToggle}>
        <span className="product-form-v2__accordion-copy"><strong>{title}</strong><small>{description}</small></span>
        <span className="product-form-v2__accordion-summary">{summary}</span>
        <ChevronDown aria-hidden="true" size={18} />
      </button>
      {isOpen && <div id={contentId} className="product-form-v2__accordion-content">{children}</div>}
    </section>
  );
}
