// Neutral registry: no database, tenant or network imports in the startup shell.
const blockers = new Set();
let activeWrites = 0;
let readCartState = null;

// POS registers the reader only when loaded. The PWA startup shell must
// not directly import the cart, Dexie or checkout dependencies.
export function setAdminUpdateCartStateReader(reader) {
  readCartState = typeof reader === 'function' ? reader : null;
}
export function getAdminUpdateCartState() {
  if (!readCartState) return { hasOpenCart: false, checkoutLocked: false };
  try {
    const value = readCartState();
    return {
      hasOpenCart: value?.hasOpenCart === true,
      checkoutLocked: value?.checkoutLocked === true
    };
  } catch {
    return { hasOpenCart: false, checkoutLocked: true };
  }
}
export function registerAdminUpdateBlocker(reason) {
  const blocker = { reason };
  blockers.add(blocker);
  return () => blockers.delete(blocker);
}
export const getAdminUpdateDraftBlockReason = () => [...blockers][0]?.reason || null;
export const hasAdminUpdateWrites = () => activeWrites > 0;

export function installAdminUpdateWriteTracking(database) {
  database.use({
    stack: 'dbcore', name: 'lanzo-update-write-tracking',
    create: down => ({
      ...down,
      transaction(stores, mode, options) {
        const transaction = down.transaction(stores, mode, options);
        if (mode === 'readwrite') {
          activeWrites += 1;
          let settled = false;
          const finish = () => {
            if (settled) return;
            settled = true;
            activeWrites -= 1;
          };
          transaction.addEventListener('complete', finish, { once: true });
          transaction.addEventListener('abort', finish, { once: true });
        }
        return transaction;
      },
    }),
  });
  return database;
}
