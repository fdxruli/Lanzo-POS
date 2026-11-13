const TABS = [
  { key: 'all', label: 'Todas' },
  { key: 'unread', label: 'No leídas' },
  { key: 'support', label: 'Soporte' },
  { key: 'ecommerce', label: 'Pedidos online' },
  { key: 'inventory', label: 'Inventario' },
  { key: 'operations', label: 'Operaciones' },
  { key: 'license', label: 'Licencia' },
  { key: 'system', label: 'Sistema' }
];

export default function NotificationTabs({
  activeTab = 'all',
  onTabChange,
  showSupport = true,
  showInventory = true,
  categoryAccess = {},
  counts = {}
}) {
  const visibleTabs = TABS.filter((tab) => {
    if (tab.key === 'support' && !showSupport) return false;
    if (tab.key === 'inventory' && !showInventory) return false;
    return !Object.hasOwn(categoryAccess, tab.key) || categoryAccess[tab.key] !== false;
  });

  return (
    <div
      className="notification-tabs"
      role="tablist"
      aria-label="Filtrar notificaciones"
      data-tab-count={visibleTabs.length}
    >
      {visibleTabs.map((tab) => {
        const count = Number(counts[tab.key] || 0);
        const countLabel = tab.key === 'unread' ? 'notificaciones no leídas' : 'notificaciones';

        return (
          <button
            key={tab.key}
            type="button"
            role="tab"
            className={`notification-tab ${activeTab === tab.key ? 'is-active' : ''}`}
            aria-label={count > 0 ? `${tab.label}, ${count} ${countLabel}` : tab.label}
            aria-selected={activeTab === tab.key}
            tabIndex={activeTab === tab.key ? 0 : -1}
            onClick={() => onTabChange(tab.key)}
            onKeyDown={(event) => {
              const currentIndex = visibleTabs.findIndex((visibleTab) => visibleTab.key === tab.key);
              let nextIndex = null;

              if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % visibleTabs.length;
              if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + visibleTabs.length) % visibleTabs.length;
              if (event.key === 'Home') nextIndex = 0;
              if (event.key === 'End') nextIndex = visibleTabs.length - 1;
              if (nextIndex === null) return;

              event.preventDefault();
              onTabChange(visibleTabs[nextIndex].key);
              event.currentTarget.parentElement
                ?.querySelectorAll('[role="tab"]')
                ?.[nextIndex]
                ?.focus();
            }}
          >
            <span>{tab.label}</span>
            {count > 0 && (
              <span className="notification-tab__count" aria-hidden="true">
                {count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
