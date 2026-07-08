import { Bell, Bot, FileText, ShieldCheck } from 'lucide-react';
import { useFeatureConfig } from '../../hooks/useFeatureConfig';
import { useActiveOrders } from '../../hooks/pos/useActiveOrders';
import { CASH_OPENING_POLICY } from '../../services/cashOpeningPolicyService.js';
import { isCloudCashSyncEnabled } from '../../services/sync/syncConstants.js';
import { useAppStore } from '../../store/useAppStore';

function SettingsSwitch({ checked, disabled = false, warning = false, onChange, ariaLabel }) {
  return (
    <label className={`settings-switch ${disabled ? 'is-disabled' : ''}`}>
      <input
        className="settings-switch__input"
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={onChange}
        aria-label={ariaLabel}
      />
      <span className={`settings-switch__track ${checked ? 'is-on' : ''} ${warning ? 'is-warning' : ''} ${disabled ? 'is-disabled' : ''}`} />
      <span className={`settings-switch__thumb ${checked ? 'is-on' : ''}`} />
    </label>
  );
}

export default function OperationalSettings() {
  const showTicker = useAppStore((state) => state.showTicker);
  const setShowTicker = useAppStore((state) => state.setShowTicker);
  const showAssistantBot = useAppStore((state) => state.showAssistantBot);
  const setShowAssistantBot = useAppStore((state) => state.setShowAssistantBot);
  const enableMultipleOrders = useAppStore((state) => state.enableMultipleOrders);
  const setEnableMultipleOrders = useAppStore((state) => state.setEnableMultipleOrders);
  const cashOpeningPolicy = useAppStore((state) => state.cashOpeningPolicy);
  const setCashOpeningPolicy = useAppStore((state) => state.setCashOpeningPolicy);
  const licenseDetails = useAppStore((state) => state.licenseDetails);
  const activeOrdersCount = useActiveOrders((state) => state.activeOrders.size);
  const features = useFeatureConfig();

  const hasMultipleActiveOrders = activeOrdersCount > 1;
  const multipleOrdersLocked = enableMultipleOrders && hasMultipleActiveOrders;
  const shouldShowMultipleOrdersControl = !features.hasTables;
  const cloudCashSyncEnabled = isCloudCashSyncEnabled(licenseDetails);
  const automaticCashOpening = !cloudCashSyncEnabled && cashOpeningPolicy === CASH_OPENING_POLICY.AUTOMATIC;

  return (
    <div className="company-form-container settings-control-panel">
      <div className="settings-panel-header">
        <div className="settings-title-row">
          <h3 className="subtitle settings-title-inline">Controles operativos</h3>
        </div>
        <span className="settings-lock-note">Activa o desactiva funciones visibles durante la venta.</span>
      </div>

      <div className="settings-control-grid">
        <div className="settings-option-row settings-control-card">
          <div className="settings-option-main">
            <div className={`settings-icon-bubble ${showTicker ? 'settings-icon-bubble--info' : 'settings-icon-bubble--muted'}`}>
              <Bell size={22} />
            </div>
            <div className="settings-option-copy">
              <span className="settings-option-title">Ticker de alertas</span>
              <p>Muestra la cinta superior con avisos de stock bajo, caducidad y mensajes en cola.</p>
              <span className="settings-option-meta">
                {showTicker ? 'Activo: las alertas se muestran en pantalla.' : 'Oculto: no verás la cinta de alertas.'}
              </span>
            </div>
          </div>
          <SettingsSwitch
            checked={!!showTicker}
            onChange={(event) => setShowTicker(event.target.checked)}
            ariaLabel="Activar ticker de alertas"
          />
        </div>

        <div className="settings-option-row settings-control-card">
          <div className="settings-option-main">
            <div className={`settings-icon-bubble ${showAssistantBot ? 'settings-icon-bubble--info' : 'settings-icon-bubble--muted'}`}>
              <Bot size={22} />
            </div>
            <div className="settings-option-copy">
              <span className="settings-option-title">Lanzo Bot</span>
              <p>Habilita el asistente para sugerencias y ayuda operativa dentro del sistema.</p>
              <span className="settings-option-meta">
                {showAssistantBot ? 'Activo: el asistente puede aparecer con sugerencias.' : 'Desactivado: el asistente queda oculto.'}
              </span>
            </div>
          </div>
          <SettingsSwitch
            checked={!!showAssistantBot}
            onChange={(event) => setShowAssistantBot(event.target.checked)}
            ariaLabel="Activar Lanzo Bot"
          />
        </div>

        {shouldShowMultipleOrdersControl && (
        <div className={`settings-option-row settings-control-card ${multipleOrdersLocked ? 'settings-option-row--disabled' : ''}`}>
          <div className="settings-option-main">
            <div className={`settings-icon-bubble ${enableMultipleOrders ? 'settings-icon-bubble--info' : 'settings-icon-bubble--muted'}`}>
              <FileText size={22} />
            </div>
            <div className="settings-option-copy">
              <span className="settings-option-title">Múltiples ventas</span>
              <p>Permite atender varias órdenes abiertas a la vez usando pestañas en el POS.</p>
              <span className="settings-option-meta">
                {enableMultipleOrders ? 'Activo: puedes trabajar con ventas simultáneas.' : 'Desactivado: una venta a la vez.'}
              </span>
              {multipleOrdersLocked && (
                <span className="settings-warning-text">
                  Cierra, cobra o cancela las órdenes secundarias antes de desactivar esta función.
                </span>
              )}
              {!enableMultipleOrders && hasMultipleActiveOrders && (
                <span className="settings-warning-text">
                  Hay ventas simultaneas abiertas. Puedes reactivar la funcion o cerrarlas desde el POS.
                </span>
              )}
            </div>
          </div>
          <SettingsSwitch
            checked={!!enableMultipleOrders}
            disabled={multipleOrdersLocked}
            onChange={(event) => {
              if (!event.target.checked && hasMultipleActiveOrders) return;
              setEnableMultipleOrders(event.target.checked);
            }}
            ariaLabel="Activar multiples ventas"
          />
        </div>
        )}

        <div className={`settings-option-row settings-control-card ${automaticCashOpening ? 'settings-option-row--warning' : ''}`}>
          <div className="settings-option-main">
            <div className={`settings-icon-bubble ${automaticCashOpening ? 'settings-icon-bubble--warning' : 'settings-icon-bubble--success'}`}>
              <ShieldCheck size={22} />
            </div>
            <div className="settings-option-copy">
              <span className="settings-option-title">Caja automática</span>
              <p>Define si la caja puede abrirse heredando fondo o si exige confirmación del operador.</p>
              <span className="settings-option-meta">
                {cloudCashSyncEnabled
                  ? 'No disponible en PRO: la caja cloud requiere confirmación de apertura por auditoría.'
                  : automaticCashOpening
                    ? 'Automática: puede heredar el fondo del cierre anterior. Verifica que el efectivo físico exista.'
                    : 'Manual: exige fondo confirmado, conteo físico y responsable.'}
              </span>
              {automaticCashOpening && (
                <span className="settings-warning-text">
                  Atención: si el cierre anterior dejó fondo para el siguiente turno, la caja se abrirá con ese monto. Si el efectivo físico no está en caja, cambia a apertura manual.
                </span>
              )}
            </div>
          </div>
          <SettingsSwitch
            checked={automaticCashOpening}
            disabled={cloudCashSyncEnabled}
            warning={automaticCashOpening}
            onChange={(event) => {
              if (cloudCashSyncEnabled) return;
              setCashOpeningPolicy(
                event.target.checked
                  ? CASH_OPENING_POLICY.AUTOMATIC
                  : CASH_OPENING_POLICY.MANUAL
              );
            }}
            ariaLabel="Permitir autoapertura de caja"
          />
        </div>
      </div>
    </div>
  );
}
