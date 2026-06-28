import { useState, useEffect } from 'react';
import './SettingsPage.css';
import GeneralSettings from '../components/settings/GeneralSettings';
import LicenseSettings from '../components/settings/LicenseSettings';
import MaintenanceSettings from '../components/settings/MaintenanceSettings';
import BackupSettings from '../components/settings/BackupSettings';
import DbMigrationTester from '../components/debug/DbMigrationTester';
import SalesSystemTester from '../components/debug/SystemHealthTester';
import { useSearchParams } from 'react-router-dom';
import { useAppStore } from '../store/useAppStore';

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState('general');
  const [searchParams, setSearchParams] = useSearchParams();
  const canAccess = useAppStore((state) => state.canAccess);
  useAppStore((state) => state.currentDeviceRole);
  useAppStore((state) => state.currentStaffUser);
  const visibleTabs = [
    { key: 'general', label: 'Datos y Apariencia', allowed: canAccess('settings') },
    { key: 'license', label: 'Licencia y Rubros', allowed: canAccess('license') },
    { key: 'maintenance', label: 'Datos y Mantenimiento', allowed: canAccess('sync') || canAccess('inventory') },
    { key: 'backup', label: 'Respaldos', allowed: canAccess('sync') },
    { key: 'debug', label: 'Depuracion DB', allowed: import.meta.env.DEV },
    { key: 'test-ventas', label: 'Test Ventas', allowed: import.meta.env.DEV }
  ].filter((tab) => tab.allowed);

  useEffect(() => {
    const tabParam = searchParams.get('tab');
    const tabMap = {
      'general': 'general',
      'license': 'license',
      'maintenance': 'maintenance',
      'backup': 'backup',
      'debug': 'debug',
      'test-ventas': 'test-ventas'
    };

    // CORRECCIÓN: Manejar tanto si existe el param como si no
    const requestedTab = tabParam && tabMap[tabParam] ? tabMap[tabParam] : 'general';
    const fallbackTab = visibleTabs[0]?.key || 'general';

    if (visibleTabs.some((tab) => tab.key === requestedTab)) {
      setActiveTab(requestedTab);
    } else {
      // Si no hay parámetro (o es inválido), forzamos la vista general
      setActiveTab(fallbackTab);
    }
  }, [searchParams, visibleTabs]);

  const handleTabChange = (tabKey) => {
    // Si es 'general', limpiamos la URL, si no, ponemos el parámetro
    const param = tabKey === 'general' ? {} : { tab: tabKey };
    setSearchParams(param);
  };

  return (
    <main className="ui-page settings-page-wrapper" aria-labelledby="settings-page-title">
      <header className="ui-page__header settings-page__header">
        <div>
          <h1 id="settings-page-title" className="ui-page__title">Configuracion</h1>
          <p className="ui-page__subtitle">Ajustes del negocio, licencia, mantenimiento y respaldos.</p>
        </div>
      </header>

      <section className="ui-section settings-tabs-section" aria-label="Secciones de configuracion">
      <div className="tabs-container settings-tabs">
        <button
          className={`tab-btn ${activeTab === 'general' ? 'active' : ''}`}
          onClick={() => handleTabChange('general')}
          hidden={!visibleTabs.some((tab) => tab.key === 'general')}
        >
          Datos y Apariencia
        </button>
        <button
          className={`tab-btn ${activeTab === 'license' ? 'active' : ''}`}
          onClick={() => handleTabChange('license')}
          hidden={!visibleTabs.some((tab) => tab.key === 'license')}
        >
          Licencia y Rubros
        </button>
        <button
          className={`tab-btn ${activeTab === 'maintenance' ? 'active' : ''}`}
          onClick={() => handleTabChange('maintenance')}
          hidden={!visibleTabs.some((tab) => tab.key === 'maintenance')}
        >
          Datos y Mantenimiento
        </button>
        <button
          className={`tab-btn ${activeTab === 'backup' ? 'active' : ''}`}
          onClick={() => handleTabChange('backup')}
          hidden={!visibleTabs.some((tab) => tab.key === 'backup')}
        >
          Respaldos
        </button>
        {import.meta.env.DEV && (
          <button
            className={`tab-btn ${activeTab === 'test-ventas' ? 'active' : ''}`} // Ajusta 'tab-btn' a tu clase CSS real
            onClick={() => handleTabChange('debug')}
          >
            Depuración DB
          </button>
        )}

        {import.meta.env.DEV && (
          <button
            className={`tab-btn ${activeTab === 'debug' ? 'active' : ''}`} // Ajusta 'tab-btn' a tu clase CSS real
            onClick={() => handleTabChange('test-ventas')}
          >
            Test Ventas
          </button>
        )}
      </div>
      </section>

      <section className="ui-section settings-content">
        {activeTab === 'general' && <GeneralSettings />}
        {activeTab === 'license' && <LicenseSettings />}
        {activeTab === 'maintenance' && <MaintenanceSettings />}
        {activeTab === 'backup' && <BackupSettings />}
        {activeTab === 'debug' && (
          <div className="ui-card debug-section">
            <h3>Zona de Peligro & Pruebas</h3>
            <p className="text-warning">
              Herramienta técnica para verificar la migración a Dexie v2.
              Usa esto solo si sabes lo que haces.
            </p>
            <DbMigrationTester />
          </div>
        )}
        {activeTab === 'test-ventas' && (
          <div className="ui-card debug-section">
            <h3>Zona de Peligro & Pruebas</h3>
            <p className="text-warning">
              Herramienta técnica para verificar la migración de salesService.js
            </p>
            <SalesSystemTester />
          </div>
        )}
      </section>
    </main>
  );
}
