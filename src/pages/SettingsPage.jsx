import { useState, useEffect, useMemo } from 'react';
import './SettingsPage.css';
import GeneralSettings from '../components/settings/GeneralSettings';
import OperationalSettings from '../components/settings/OperationalSettings';
import LicenseSettings from '../components/settings/LicenseSettings';
import MaintenanceSettings from '../components/settings/MaintenanceSettings';
import BackupSettings from '../components/settings/BackupSettings';
import DbMigrationTester from '../components/debug/DbMigrationTester';
import SalesSystemTester from '../components/debug/SystemHealthTester';
import { useSearchParams } from 'react-router-dom';
import { useAppStore } from '../store/useAppStore';
import { isCloudPosSyncEnabled } from '../services/sync/syncConstants';
import {
  resolveAllowedSettingsTab
} from './settingsPageAccess';

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState('general');
  const [searchParams, setSearchParams] = useSearchParams();
  const canAccess = useAppStore((state) => state.canAccess);
  const licenseDetails = useAppStore((state) => state.licenseDetails);

  const isCloudLicense = isCloudPosSyncEnabled(licenseDetails);

  const visibleTabs = useMemo(() => [
    { key: 'general', allowed: canAccess('settings') },
    { key: 'controls', allowed: canAccess('settings') },
    { key: 'license', allowed: canAccess('license') },
    { key: 'maintenance', allowed: canAccess('sync') || canAccess('inventory') },
    { key: 'backup', allowed: canAccess('sync') },
    { key: 'debug', allowed: import.meta.env.DEV },
    { key: 'test-ventas', allowed: import.meta.env.DEV }
  ].filter((tab) => tab.allowed), [canAccess]);

  useEffect(() => {
    const tabParam = searchParams.get('tab');
    const tabMap = {
      general: 'general',
      controls: 'controls',
      license: 'license',
      maintenance: 'maintenance',
      backup: 'backup',
      debug: 'debug',
      'test-ventas': 'test-ventas'
    };

    const requestedTab = tabParam && tabMap[tabParam] ? tabMap[tabParam] : 'general';

    setActiveTab(resolveAllowedSettingsTab({
      requestedTab,
      visibleTabs
    }));
  }, [searchParams, visibleTabs]);

  const handleTabChange = (tabKey) => {
    const param = tabKey === 'general' ? {} : { tab: tabKey };
    setSearchParams(param);
  };

  const tabIsVisible = (key) => visibleTabs.some((tab) => tab.key === key);

  return (
    <main className="ui-page settings-page-wrapper" aria-label="Configuracion">
      <section className="ui-section settings-tabs-section" aria-label="Secciones de configuracion">
        <div className="tabs-container settings-tabs">
          <button type="button" className={`tab-btn ${activeTab === 'general' ? 'active' : ''}`} onClick={() => handleTabChange('general')} hidden={!tabIsVisible('general')}>Datos y Apariencia</button>
          <button type="button" className={`tab-btn ${activeTab === 'controls' ? 'active' : ''}`} onClick={() => handleTabChange('controls')} hidden={!tabIsVisible('controls')}>Controles</button>
          <button type="button" className={`tab-btn ${activeTab === 'license' ? 'active' : ''}`} onClick={() => handleTabChange('license')} hidden={!tabIsVisible('license')}>Licencia y Rubros</button>
          <button type="button" className={`tab-btn ${activeTab === 'maintenance' ? 'active' : ''}`} onClick={() => handleTabChange('maintenance')} hidden={!tabIsVisible('maintenance')}>Datos y Mantenimiento</button>
          <button type="button" className={`tab-btn ${activeTab === 'backup' ? 'active' : ''}`} onClick={() => handleTabChange('backup')} hidden={!tabIsVisible('backup')}>Respaldos</button>
          {import.meta.env.DEV && <button type="button" className={`tab-btn ${activeTab === 'debug' ? 'active' : ''}`} onClick={() => handleTabChange('debug')}>Depuracion DB</button>}
          {import.meta.env.DEV && <button type="button" className={`tab-btn ${activeTab === 'test-ventas' ? 'active' : ''}`} onClick={() => handleTabChange('test-ventas')}>Test Ventas</button>}
        </div>
      </section>

      <section className="ui-section settings-content">
        {activeTab === 'general' && <GeneralSettings />}
        {activeTab === 'controls' && <OperationalSettings />}
        {activeTab === 'license' && <LicenseSettings />}
        {activeTab === 'maintenance' && <MaintenanceSettings />}
        {activeTab === 'backup' && (
          <>
            {isCloudLicense && (
              <div className="ui-card backup-cloud-license-note" role="note">
                <h3>Respaldo adicional opcional</h3>
                <p>
                  Tus datos principales se sincronizan en la nube. Puedes generar una copia local cifrada solo como respaldo adicional,
                  pero no es un requisito operativo para Lanzo Nube.
                </p>
              </div>
            )}
            <BackupSettings isCloudLicense={isCloudLicense} />
          </>
        )}
        {activeTab === 'debug' && (
          <div className="ui-card debug-section">
            <h3>Pruebas de datos</h3>
            <p className="text-warning">Herramienta tecnica para revisar la base local.</p>
            <DbMigrationTester />
          </div>
        )}
        {activeTab === 'test-ventas' && (
          <div className="ui-card debug-section">
            <h3>Pruebas de ventas</h3>
            <p className="text-warning">Herramienta tecnica para revisar ventas.</p>
            <SalesSystemTester />
          </div>
        )}
      </section>
    </main>
  );
}
