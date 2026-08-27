import { useRef } from 'react';

const tabId = (section) => `caja-tab-${section}`;
const panelId = (section) => `caja-section-${section}`;

const CajaSectionTabs = ({ sections = [], activeSection, onChange }) => {
  const tabRefs = useRef({});

  const focusTab = (section) => {
    tabRefs.current[section]?.focus();
  };

  const handleKeyDown = (event, index) => {
    if (!sections.length) return;

    let nextIndex = null;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      nextIndex = (index + 1) % sections.length;
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      nextIndex = (index - 1 + sections.length) % sections.length;
    } else if (event.key === 'Home') {
      nextIndex = 0;
    } else if (event.key === 'End') {
      nextIndex = sections.length - 1;
    }

    if (nextIndex === null) return;

    event.preventDefault();
    const nextSection = sections[nextIndex].id;
    onChange(nextSection);
    focusTab(nextSection);
  };

  return (
    <nav className="caja-section-navigation" aria-label="Secciones de Caja">
      <div className="caja-section-tabs" role="tablist" aria-label="Secciones de Caja">
        {sections.map((section, index) => {
          const isActive = activeSection === section.id;
          return (
            <button
              key={section.id}
              ref={(element) => { tabRefs.current[section.id] = element; }}
              type="button"
              id={tabId(section.id)}
              role="tab"
              aria-selected={isActive}
              aria-controls={panelId(section.id)}
              tabIndex={isActive ? 0 : -1}
              className={`caja-section-tab${isActive ? ' is-active' : ''}`}
              onClick={() => onChange(section.id)}
              onKeyDown={(event) => handleKeyDown(event, index)}
            >
              {section.label}
            </button>
          );
        })}
      </div>
    </nav>
  );
};

export { panelId, tabId };
export default CajaSectionTabs;
