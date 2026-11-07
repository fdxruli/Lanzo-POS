import { actorRuntimeController } from '../../../services/auth/actorRuntimeController';
import { resolveStableActorId } from '../../../services/auth/actorIdentity';

/**
 * License verification describes the physical device, not the signed-in actor.
 * Keep the session identity in both Zustand and the license record used by
 * bootstrap; bootstrap still verifies that session before restoring authority.
 * This neither grants ActorRuntime authority nor replaces session validation.
 */
export const reconcileLicenseSessionIdentity = (state, localLicense, validation) => {
  const role = state.currentDeviceRole || localLicense.device_role || null;
  const staff = role === 'staff'
    ? state.currentStaffUser || localLicense.staff_user || null
    : null;
  const staffId = resolveStableActorId('staff', staff);
  // A license response cannot overwrite a verified live Staff grant, even
  // when it includes the same user with older permissions.
  const runtime = actorRuntimeController.getState();
  const verifiedSessionActive = runtime.status === 'granted' && runtime.actorType === 'staff' && runtime.actorId === staffId;
  const updatedStaff = !verifiedSessionActive && staffId && resolveStableActorId('staff', validation.staff_user) === staffId
    ? validation.staff_user
    : staff;

  return {
    device_role: role,
    staff_user: updatedStaff,
    // Do not synthesize modern Admin license evidence from a store snapshot:
    // that would trigger the existing legacy-to-identity upgrade transition.
    admin_user: role === 'admin' ? localLicense.admin_user || null : null
  };
};
