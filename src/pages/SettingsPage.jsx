import { useState, useEffect, useMemo } from 'react';
import './SettingsPage.css';
import GeneralSettings from '../components/settings/GeneralSettings';
import LicenseSettings from '../components/settings/LicenseSettings';
import MaintenanceSettings from '../components/settings/MaintenanceSettings';
import BackupSettings from '../components/settings/BackupSettings';
import PreparationStationsSettings from '../components/settings/PreparationStationsSettings';
import DbMigrationTester from '../components/debug/DbMigrationTester';
import SalesSystemTester from '../components/debug/SystemHealthTester';
import { useSearchParams } from 'react-router-dom';
import { useAppStore } from '../store/useAppStore';
import { normalizeBusinessTypes } from '../utils/businessType';

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState('general');
  const [searchParams, setSearchParams] = useSearchParams();
  const canAccess = useAppStore((state) => state.canAccess);
  const businessTypes = useAppStore((state) => state.companyProfile?.business_type);
  useAppStore((state) => state.currentDeviceRole);
  useAppStore((state) => state.currentStaffUser);

  const hasRestaurantSettings = useMemo(() => (
    normalizeBusinessTypes(businessTypes || []).includes('food_service')
  ), [businessTypes]);

  const visibleTabs = [
    { key: 'general', allowed: canAccess('settings') },
    { key: 'restaurant', allowed: hasRestaurantSettings && canAccess('settings') },
    { key: 'license', allowed: canAccess('license') },
    { key: 'maintenance', allowed: canAccess('sync') || canAccess('inventory') },
    { key: 'backup', allowed: canAccess('sync') },
    { key: 'debug', allowed: import.meta.env.DEV },
    { key: 'test-ventas', allowed: import.meta.env.DEV }
  ].filter((tab) => tab.allowed);

  useEffect(() => {
    const tabParam = searchParams.get('tab');
    const tabMap = {
      general: 'general',
      restaurant: 'restaurant',
      license: 'license',
      maintenance: 'maintenance',
      backup: 'backup',
      debug: 'debug',
      'test-ventas': 'test-ventas'
    };

    const requestedTab = tabParam && tabMap[tabParam] ? tabMap[tabParam] : 'general';
    const fallbackTab = visibleTabs[0]?.key || 'general';

    if (visibleTabs.some((tab) => tab.key === requestedTab)) {
      setActiveTab(requestedTab);
    } else {
      setActiveTab(fallbackTab);
    }
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
          <button className={`tab-btn ${activeTab === 'general' ? 'active' : ''}`} onClick={() => handleTabChange('general')} hidden={!tabIsVisible('general')}>Datos y Apariencia</button>
          <button className={`tab-btn ${activeTab === 'restaurant' ? 'active' : ''}`} onClick={() => handleTabChange('restaurant')} hidden={!tabIsVisible('restaurant')}>Restaurante</button>
          <button className={`tab-btn ${activeTab === 'license' ? 'active' : ''}`} onClick={() => handleTabChange('license')} hidden={!tabIsVisible('license')}>Licencia y Rubros</button>
          <button className={`tab-btn ${activeTab === 'maintenance' ? 'active' : ''}`} onClick={() => handleTabChange('maintenance')} hidden={!tabIsVisible('maintenance')}>Datos y Mantenimiento</button>
          <button className={`tab-btn ${activeTab === 'backup' ? 'active' : ''}`} onClick={() => handleTabChange('backup')} hidden={!tabIsVisible('backup')}>Respaldos</button>
          {import.meta.env.DEV && <button className={`tab-btn ${activeTab === 'debug' ? 'active' : ''}`} onClick={() => handleTabChange('debug')}>Depuracion DB</button>}
          {import.meta.env.DEV && <button className={`tab-btn ${activeTab === 'test-ventas' ? 'active' : ''}`} onClick={() => handleTabChange('test-ventas')}>Test Ventas</button>}
        </div>
      </section>

      <section className="ui-section settings-content">
        {activeTab === 'general' && <GeneralSettings />}
        {activeTab === 'restaurant' && <PreparationStationsSettings />}
        {activeTab === 'license' && <LicenseSettings />}
        {activeTab === 'maintenance' && <MaintenanceSettings />}
        {activeTab === 'backup' && <BackupSettings />}
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
