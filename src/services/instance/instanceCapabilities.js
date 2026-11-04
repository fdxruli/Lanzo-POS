export function inspectInstanceCapabilities(target) {
  try {
    return Object.freeze({
      secureContext: target.isSecureContext === true,
      randomIdentity: typeof target.crypto?.getRandomValues === 'function',
      webLocks: typeof target.navigator?.locks?.request === 'function',
      broadcastChannel: typeof target.BroadcastChannel === 'function',
    });
  } catch {
    return Object.freeze({ secureContext: false, randomIdentity: false, webLocks: false, broadcastChannel: false });
  }
}
