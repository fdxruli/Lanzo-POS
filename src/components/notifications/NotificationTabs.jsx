const TABS = [
  { key: 'all', label: 'Todas' },
  { key: 'unread', label: 'No leídas' },
  { key: 'support', label: 'Soporte' },
  { key: 'operation', label: 'Operación' },
  { key: 'license', label: 'Licencia' },
  { key: 'system', label: 'Sistema' }
];

export default function NotificationTabs({
  activeTab = 'all',
  onTabChange,
  showSupport = true,
  counts = {}
}) {
  const visibleTabs = showSupport
    ? TABS
    : TABS.filter((tab) => tab.key !== 'support');

  return (
    <div
      className="notification-tabs"
      role="tablist"
      aria-label="Filtrar notificaciones"
      data-tab-count={visibleTabs.length}
    >
      {visibleTabs.map((tab) => (
        <button
          key={tab.key}
          type="button"
          role="tab"
          className={`notification-tab ${activeTab === tab.key ? 'is-active' : ''}`}
          aria-selected={activeTab === tab.key}
          onClick={() => onTabChange(tab.key)}
        >
          <span>{tab.label}</span>
          {Number(counts[tab.key] || 0) > 0 && (
            <span className="notification-tab__count" aria-label={`${counts[tab.key]} pendientes`}>
              {counts[tab.key]}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
