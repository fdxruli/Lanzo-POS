export async function updateExistingAdminWorkerOnPublicRoute(navigatorRef = navigator) {
  if (!navigatorRef.serviceWorker?.getRegistration) return false;

  try {
    const registration = await navigatorRef.serviceWorker.getRegistration('/');
    if (!registration) return false;
    await registration.update();
    return true;
  } catch {
    return false;
  }
}
