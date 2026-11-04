// Same-origin Web Locks coordinate only an exact captured actor context. No
// BroadcastChannel/localStorage, credentials, JWTs or cross-actor token sharing.
export async function acquireEcomSignalLeadership(contextKey, signal, locks = globalThis.navigator?.locks) {
  if (!locks) return () => {}; // Per-JS owner guard remains; no cross-tab guarantee.
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(contextKey));
  const name = 'lanzo-ecom-qa:' + Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
  return new Promise((resolve, reject) => {
    let release;
    const done = locks.request(name, { mode: 'exclusive', signal }, () => new Promise(unlock => {
      release = () => { signal.removeEventListener('abort', release); unlock(); };
      signal.addEventListener('abort', release, { once: true });
      if (signal.aborted) { release(); reject(new DOMException('Aborted', 'AbortError')); }
      else resolve(release);
    }));
    done.catch(reject);
  });
}
