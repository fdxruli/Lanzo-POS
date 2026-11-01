import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { acquireEcomSignalLeadership } from '../../src/services/ecommerce/ecomSignalLeadership.js';

const expectedLockName = (context) => `lanzo-ecom-qa:${createHash('sha256')
  .update(context)
  .digest('hex')}`;

const createTestLocks = () => {
  const tails = new Map();
  const requestCounts = new Map();
  const names = [];
  const waiters = new Set();

  const notifyWaiters = () => {
    for (const waiter of waiters) {
      if (waiter.requirements.every(([name, count]) => (
        (requestCounts.get(name) || 0) >= count
      ))) {
        waiters.delete(waiter);
        waiter.resolve();
      }
    }
  };

  const locks = {
    names,
    request: (name, { signal }, callback) => {
      names.push(name);
      requestCounts.set(name, (requestCounts.get(name) || 0) + 1);
      notifyWaiters();

      const old = tails.get(name) ?? Promise.resolve();
      const next = old.then(() => {
        if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
        return callback();
      });
      tails.set(name, next.catch(() => {}));
      return next;
    },
    waitForRequests: (requirements) => {
      const entries = Object.entries(requirements);
      if (entries.every(([name, count]) => (
        (requestCounts.get(name) || 0) >= count
      ))) return Promise.resolve();

      return new Promise((resolve) => {
        waiters.add({ requirements: entries, resolve });
      });
    }
  };

  return locks;
};

test('same actor context serializes leaders and distinct contexts stay isolated', async () => {
  const locks = createTestLocks();
  const contextA = 'tenant-a/admin/session-token-a/device-a';
  const contextB = 'tenant-a/staff/session-token-b/device-a';
  const nameA = expectedLockName(contextA);
  const nameB = expectedLockName(contextB);
  assert.notEqual(nameA, nameB);

  const ownerController = new AbortController();
  const queuedController = new AbortController();
  const otherController = new AbortController();
  const ownerPromise = acquireEcomSignalLeadership(contextA, ownerController.signal, locks);
  await locks.waitForRequests({ [nameA]: 1 });
  const releaseOwner = await ownerPromise;

  let queuedGranted = false;
  const queuedPromise = acquireEcomSignalLeadership(
    contextA,
    queuedController.signal,
    locks
  ).then((release) => {
    queuedGranted = true;
    return release;
  });
  const otherPromise = acquireEcomSignalLeadership(contextB, otherController.signal, locks);

  await locks.waitForRequests({ [nameA]: 2, [nameB]: 1 });
  const releaseOther = await otherPromise;
  assert.equal(queuedGranted, false);

  releaseOther();
  otherController.abort();
  releaseOwner();
  const releaseQueued = await queuedPromise;
  assert.equal(queuedGranted, true);
  releaseQueued();
  queuedController.abort();
  ownerController.abort();

  assert.equal(locks.names.filter((name) => name === nameA).length, 2);
  assert.equal(locks.names.filter((name) => name === nameB).length, 1);
  assert.ok(locks.names.every((name) => /^lanzo-ecom-qa:[a-f0-9]{64}$/.test(name)));
  assert.doesNotMatch(locks.names.join(','), /tenant|session|device|token/i);
});

test('aborting a queued actor releases its request without acquiring the lock', async () => {
  const locks = createTestLocks();
  const context = 'tenant-b/admin/session-token-c/device-b';
  const name = expectedLockName(context);
  const ownerController = new AbortController();
  const queuedController = new AbortController();

  const ownerPromise = acquireEcomSignalLeadership(context, ownerController.signal, locks);
  await locks.waitForRequests({ [name]: 1 });
  const releaseOwner = await ownerPromise;
  const queuedPromise = acquireEcomSignalLeadership(context, queuedController.signal, locks);
  const queuedOutcome = queuedPromise.then(
    () => ({ acquired: true }),
    (error) => ({ acquired: false, error })
  );
  await locks.waitForRequests({ [name]: 2 });

  queuedController.abort();
  releaseOwner();
  const outcome = await queuedOutcome;
  assert.equal(outcome.acquired, false);
  assert.equal(outcome.error?.name, 'AbortError');
  ownerController.abort();

  assert.deepEqual(locks.names, [name, name]);
  assert.doesNotMatch(locks.names.join(','), /tenant|session|device|token/i);
});
