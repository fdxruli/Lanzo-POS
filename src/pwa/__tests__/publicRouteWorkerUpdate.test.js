// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { updateExistingAdminWorkerOnPublicRoute } from '../publicRouteWorkerUpdate';

describe('public-route worker transition check', () => {
  it('does not create a registration when none exists', async () => {
    const getRegistration = vi.fn().mockResolvedValue(undefined);
    const navigatorRef = { serviceWorker: { getRegistration, register: vi.fn() } };

    await expect(updateExistingAdminWorkerOnPublicRoute(navigatorRef)).resolves.toBe(false);
    expect(getRegistration).toHaveBeenCalledWith('/');
    expect(navigatorRef.serviceWorker.register).not.toHaveBeenCalled();
  });

  it('updates an existing registration without activating or unregistering it', async () => {
    const registration = { update: vi.fn().mockResolvedValue(undefined), unregister: vi.fn() };
    const navigatorRef = { serviceWorker: { getRegistration: vi.fn().mockResolvedValue(registration) } };

    await expect(updateExistingAdminWorkerOnPublicRoute(navigatorRef)).resolves.toBe(true);
    expect(registration.update).toHaveBeenCalledOnce();
    expect(registration.unregister).not.toHaveBeenCalled();
  });

  it('keeps update errors invisible on a temporary public route', async () => {
    const navigatorRef = {
      serviceWorker: {
        getRegistration: vi.fn().mockRejectedValue(new Error('synthetic failure')),
      },
    };

    await expect(updateExistingAdminWorkerOnPublicRoute(navigatorRef)).resolves.toBe(false);
  });
});
