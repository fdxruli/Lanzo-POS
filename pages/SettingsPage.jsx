import React, { useState } from 'react';
import './SettingsPage.css';

// Importamos los nuevos módulos
import GeneralSettings from '../components/settings/GeneralSettings';
import LicenseSettings from '../components/settings/LicenseSettings';
import MaintenanceSettings from '../components/settings/MaintenanceSettings';

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState('general');

  return (
    <div className="settings-page-wrapper">
      <div className="tabs-container">
        <button
          className={`tab-btn ${activeTab === 'general' ? 'active' : ''}`}
          onClick={() => setActiveTab('general')}
        >
          Datos y Apariencia
        </button>
        <button
          className={`tab-btn ${activeTab === 'license' ? 'active' : ''}`}
          onClick={() => setActiveTab('license')}
        >
          Licencia y Rubros
        </button>
        <button
          className={`tab-btn ${activeTab === 'maintenance' ? 'active' : ''}`}
          onClick={() => setActiveTab('maintenance')}
        >
          Datos y Mantenimiento
        </button>
      </div>

      <div className="settings-content">
        {activeTab === 'general' && <GeneralSettings />}
        {activeTab === 'license' && <LicenseSettings />}
        {activeTab === 'maintenance' && <MaintenanceSettings />}
      </div>
    </div>
  );
}