import { useEffect, useId, useState } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { PHARMACY_DOSAGE_FORMS } from '../../services/pharmacy/pharmacyCatalog';
import {
  EMPTY_PHARMACY_SEARCH_FILTERS,
  hasPharmacySearchFilters
} from '../../services/pharmacy/pharmacyProductSearch';
import './PharmacySearchFilters.css';

const copyFilters = (filters = EMPTY_PHARMACY_SEARCH_FILTERS) => ({
  dosageFormCode: filters.dosageFormCode || '',
  concentration: filters.concentration || '',
  presentation: filters.presentation || ''
});

export default function PharmacySearchFilters({ value, onChange, className = '' }) {
  const id = useId();
  const [draft, setDraft] = useState(() => copyFilters(value));
  const appliedCount = Object.values(copyFilters(value)).filter(Boolean).length;
  const draftHasFilters = hasPharmacySearchFilters(draft);

  useEffect(() => {
    setDraft(copyFilters(value));
  }, [value]);

  const updateDraft = (field, nextValue) => {
    setDraft((current) => ({ ...current, [field]: nextValue }));
  };

  const applyFilters = (event) => {
    event.preventDefault();
    onChange?.(copyFilters(draft));
  };

  const clearFilters = () => {
    setDraft(copyFilters(EMPTY_PHARMACY_SEARCH_FILTERS));
    onChange?.(copyFilters(EMPTY_PHARMACY_SEARCH_FILTERS));
  };

  return (
    <details className={`pharmacy-search-filters ${className}`.trim()}>
      <summary>
        <SlidersHorizontal size={15} aria-hidden="true" />
        <span>Filtros de farmacia</span>
        {appliedCount > 0 && <span className="pharmacy-search-filters__count">{appliedCount}</span>}
      </summary>
      <form className="pharmacy-search-filters__panel" onSubmit={applyFilters}>
        <label className="pharmacy-search-filters__field" htmlFor={`${id}-form`}>
          <span>Forma farmacéutica</span>
          <select
            id={`${id}-form`}
            value={draft.dosageFormCode}
            onChange={(event) => updateDraft('dosageFormCode', event.target.value)}
          >
            <option value="">Cualquier forma</option>
            {PHARMACY_DOSAGE_FORMS.map(({ value: code, label }) => (
              <option key={code} value={code}>{label}</option>
            ))}
          </select>
        </label>
        <label className="pharmacy-search-filters__field" htmlFor={`${id}-concentration`}>
          <span>Concentración</span>
          <input
            id={`${id}-concentration`}
            type="search"
            inputMode="decimal"
            placeholder="Ej. 500 mg"
            value={draft.concentration}
            onChange={(event) => updateDraft('concentration', event.target.value)}
          />
        </label>
        <label className="pharmacy-search-filters__field" htmlFor={`${id}-presentation`}>
          <span>Presentación</span>
          <input
            id={`${id}-presentation`}
            type="search"
            placeholder="Ej. 10 tabletas"
            value={draft.presentation}
            onChange={(event) => updateDraft('presentation', event.target.value)}
          />
        </label>
        <div className="pharmacy-search-filters__actions">
          <button type="submit" className="pharmacy-search-filters__apply">Aplicar filtros</button>
          {draftHasFilters && (
            <button type="button" className="pharmacy-search-filters__clear" onClick={clearFilters}>
              Limpiar
            </button>
          )}
        </div>
      </form>
    </details>
  );
}
