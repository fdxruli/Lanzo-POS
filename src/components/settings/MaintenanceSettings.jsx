import NoPermission from '../common/NoPermission';
import UpdateControls from '../common/UpdateControls';
import { useSettingsAccess } from '../../services/auth/useSettingsAccess';

export default function MaintenanceSettings() {
  const settingsAccess = useSettingsAccess();
  if (!settingsAccess.canAccessSection('maintenance')) return <NoPermission />;

  return <UpdateControls showApply />;
}
