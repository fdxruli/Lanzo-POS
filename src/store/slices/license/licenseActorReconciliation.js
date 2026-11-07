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
  // Staff-only validation can refresh permissions, but cannot switch actors.
  // A null Staff payload on a shared device is only device metadata.
  const updatedStaff = staffId && resolveStableActorId('staff', validation.staff_user) === staffId
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
