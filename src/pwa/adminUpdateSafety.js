// Neutral registry: no database, tenant or network imports in the startup shell.
const blockers = new Set();
let activeWrites = 0;
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
