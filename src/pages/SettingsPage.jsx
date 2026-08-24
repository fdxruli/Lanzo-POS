import './SettingsPage.css';
import GeneralSettings from '../components/settings/GeneralSettings';
import OperationalSettings from '../components/settings/OperationalSettings';
import LicenseSettings from '../components/settings/LicenseSettings';
import DevicesSettings from '../components/settings/DevicesSettings';
import MaintenanceSettings from '../components/settings/MaintenanceSettings';
import BackupSettings from '../components/settings/BackupSettings';
import DbMigrationTester from '../components/debug/DbMigrationTester';
import SalesSystemTester from '../components/debug/SystemHealthTester';
import { useSearchParams } from 'react-router-dom';
import { useAppStore } from '../store/useAppStore';
import { isCloudPosSyncEnabled } from '../services/sync/syncConstants';
import NoPermission from '../components/common/NoPermission';
import { useSettingsAccess } from '../services/auth/useSettingsAccess';
import {
  resolveAllowedSettingsTab
} from './settingsPageAccess';

export default function SettingsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const licenseDetails = useAppStore((state) => state.licenseDetails);
  const settingsAccess = useSettingsAccess();

  const isCloudLicense = isCloudPosSyncEnabled(licenseDetails);
  const visibleTabs = settingsAccess.visibleTabs;
  const requestedTab = searchParams.get('tab') || 'general';
  const activeTab = resolveAllowedSettingsTab({ requestedTab, visibleTabs });

  const handleTabChange = (tabKey) => {
    const param = tabKey === 'general' ? {} : { tab: tabKey };
    setSearchParams(param);
  };

  const tabIsVisible = (key) => visibleTabs.some((tab) => tab.key === key);

  if (!settingsAccess.canEnterSettings || !activeTab) {
    return <NoPermission />;
  }

  return (
    <main className="ui-page settings-page-wrapper" aria-label="Configuracion">
      <section className="ui-section settings-tabs-section" aria-label="Secciones de configuracion">
        <div className="tabs-container settings-tabs">
          <button type="button" className={`tab-btn ${activeTab === 'general' ? 'active' : ''}`} onClick={() => handleTabChange('general')} hidden={!tabIsVisible('general')}>Datos y Apariencia</button>
          <button type="button" className={`tab-btn ${activeTab === 'controls' ? 'active' : ''}`} onClick={() => handleTabChange('controls')} hidden={!tabIsVisible('controls')}>Controles</button>
          <button type="button" className={`tab-btn ${activeTab === 'license' ? 'active' : ''}`} onClick={() => handleTabChange('license')} hidden={!tabIsVisible('license')}>Licencia y Rubros</button>
          <button type="button" className={`tab-btn ${activeTab === 'devices' ? 'active' : ''}`} onClick={() => handleTabChange('devices')} hidden={!tabIsVisible('devices')}>Dispositivos</button>
          <button type="button" className={`tab-btn ${activeTab === 'maintenance' ? 'active' : ''}`} onClick={() => handleTabChange('maintenance')} hidden={!tabIsVisible('maintenance')}>Datos y Mantenimiento</button>
          <button type="button" className={`tab-btn ${activeTab === 'backup' ? 'active' : ''}`} onClick={() => handleTabChange('backup')} hidden={!tabIsVisible('backup')}>Respaldos</button>
          {tabIsVisible('debug') && <button type="button" className={`tab-btn ${activeTab === 'debug' ? 'active' : ''}`} onClick={() => handleTabChange('debug')}>Depuracion DB</button>}
          {tabIsVisible('test-ventas') && <button type="button" className={`tab-btn ${activeTab === 'test-ventas' ? 'active' : ''}`} onClick={() => handleTabChange('test-ventas')}>Test Ventas</button>}
        </div>
      </section>

      <section
        key={`${settingsAccess.actorKey}:${settingsAccess.generation}`}
        className="ui-section settings-content"
      >
        {activeTab === 'general' && <GeneralSettings />}
        {activeTab === 'controls' && <OperationalSettings />}
        {activeTab === 'license' && <LicenseSettings />}
        {activeTab === 'devices' && <DevicesSettings />}
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
