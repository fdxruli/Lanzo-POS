import NoPermission from './NoPermission';
import { useSettingsAccess } from '../../services/auth/useSettingsAccess';

export default function SettingsRoute({ children }) {
  const access = useSettingsAccess();
  return access.canEnterSettings ? children : <NoPermission />;
}
