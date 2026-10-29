import assert from 'node:assert/strict';

function assertJsonSafe(value, path = 'cutoverEvidence', ancestors = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    assert.ok(Number.isFinite(value), path + ' must be a finite number');
    return;
  }
  assert.equal(typeof value, 'object', path + ' must contain only JSON values');
  assert.ok(!ancestors.has(value), path + ' must not contain circular references');
  ancestors.add(value);
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertJsonSafe(item, path + '[' + index + ']', ancestors));
  } else {
    const prototype = Object.getPrototypeOf(value);
    assert.ok(prototype === Object.prototype || prototype === null, path + ' must use plain objects');
    for (const key of Reflect.ownKeys(value)) {
      assert.equal(typeof key, 'string', path + ' must not contain symbol keys');
      assertJsonSafe(value[key], path + '.' + key, ancestors);
    }
  }
  ancestors.delete(value);
}

function requireText(value, path) {
  assert.equal(typeof value, 'string', path + ' must be a string');
  assert.ok(value.trim().length > 0, path + ' must not be empty');
}

function requireCount(value, path) {
  assert.ok(Number.isSafeInteger(value) && value >= 0, path + ' must be a non-negative safe integer');
}

function lockEntries(snapshot, path) {
  assert.ok(Array.isArray(snapshot) && snapshot.length > 0, path + ' must contain an observed PostgreSQL snapshot');
  for (const row of snapshot) {
    assert.ok(row && typeof row === 'object', path + ' rows must be objects');
    assert.ok(Array.isArray(row.locks), path + ' rows must preserve pg_locks');
  }
  return snapshot.flatMap(row => row.locks.map(lock => ({ row, lock })));
}

/**
 * Build and validate the SQL-09/10 evidence only after its PostgreSQL assertions pass.
 * The snapshots, SQLSTATEs, counts, timings and process results are runtime inputs.
 */
export function buildCutoverEvidence(input) {
  assert.ok(input && typeof input === 'object', 'cutover result input is required');
  requireText(input.cutoverQuery, 'cutoverQuery');
  requireText(input.unrelatedAdmissionQuery, 'unrelatedAdmissionQuery');
  assert.equal(input.unrelatedSqlSubmitted, true, 'unrelated admission SQL must have been submitted');

  const exclusive = lockEntries(input.exclusiveCutoverLockObserved, 'exclusiveCutoverLockObserved')
    .find(({ row, lock }) => row.state === 'idle in transaction' &&
      lock.locktype === 'advisory' && lock.granted === true &&
      lock.mode === 'ExclusiveLock' && lock.objsubid === 1);
  assert.ok(exclusive, 'an exclusive transition lock must be observed in pg_locks');

  const sharedWait = lockEntries(input.unrelatedShareLockWaitObserved, 'unrelatedShareLockWaitObserved')
    .find(({ row, lock }) => row.wait_event_type === 'Lock' &&
      lock.locktype === 'advisory' && lock.granted === false &&
      lock.mode === 'ShareLock' && lock.objsubid === 1);
  assert.ok(sharedWait, 'the unrelated admission must be observed waiting for the shared transition lock');
  assert.equal(sharedWait.lock.classid, exclusive.lock.classid, 'waiter and cutover lock classid must match');
  assert.equal(sharedWait.lock.objid, exclusive.lock.objid, 'waiter and cutover lock objid must match');

  for (const [key, value] of Object.entries({
    unrelatedWaitObservedAfterMs: input.unrelatedWaitObservedAfterMs,
    unrelatedAdmissionResumedAfterMs: input.unrelatedAdmissionResumedAfterMs,
    cutoverExitCode: input.cutoverExitCode,
    unrelatedExitCode: input.unrelatedExitCode,
    sessionsRemaining: input.sessionsRemaining,
    reentrantSharedLocks: input.reentrantSharedLocks,
    cashMovementsBefore: input.finalFinancialEffects?.cashMovementsBefore,
    cashMovementsAfter: input.finalFinancialEffects?.cashMovementsAfter,
    unrelatedParentAdvisoryLocks: input.finalFinancialEffects?.unrelatedParentAdvisoryLocks
  })) requireCount(value, key);

  assert.ok(input.unrelatedAdmissionResumedAfterMs >= input.unrelatedWaitObservedAfterMs,
    'admission resume time must follow the observed lock wait');
  assert.equal(input.cutoverExitCode, 0, 'cutover session must finish successfully');
  assert.equal(input.unrelatedExitCode, 0, 'unrelated admission rollback must finish successfully');
  assert.equal(input.sessionsRemaining, 0, 'no SQL-09/10 psql sessions may remain');
  assert.equal(input.reentrantSharedLocks, 1, 'reentrant admission must hold exactly one shared lock');
  assert.equal(input.finalFinancialEffects.cashMovementsAfter, input.finalFinancialEffects.cashMovementsBefore,
    'rollback must preserve the cash movement count');
  assert.equal(input.finalFinancialEffects.unrelatedParentAdvisoryLocks, 0,
    'other-rubro admission must not acquire a Restaurant-parent lock');
  assert.equal(input.pausedRestaurantSqlstate, 'P0001', 'paused Restaurant writes must return the expected SQLSTATE');
  requireText(input.limitation, 'limitation');

  const report = {
    case: 'SQL-09/10 paused other-rubro admission and cutover',
    result: 'PASS',
    semantics: 'ADMITTED_NO_PARENT_LOCK_GLOBAL_CUTOVER_WAIT_OBSERVED_ROLLBACK_RELEASED',
    cutoverQuery: input.cutoverQuery,
    unrelatedAdmissionQuery: input.unrelatedAdmissionQuery,
    unrelatedSqlSubmitted: input.unrelatedSqlSubmitted,
    exclusiveCutoverLockObserved: input.exclusiveCutoverLockObserved,
    unrelatedShareLockWaitObserved: input.unrelatedShareLockWaitObserved,
    releaseOrder: 'commit_cutover_then_unrelated_admission_rollback',
    unrelatedWaitObservedAfterMs: input.unrelatedWaitObservedAfterMs,
    unrelatedAdmissionResumedAfterMs: input.unrelatedAdmissionResumedAfterMs,
    cutoverExitCode: input.cutoverExitCode,
    unrelatedExitCode: input.unrelatedExitCode,
    finalFinancialEffects: {
      cashMovementsBefore: input.finalFinancialEffects.cashMovementsBefore,
      cashMovementsAfter: input.finalFinancialEffects.cashMovementsAfter,
      unrelatedParentAdvisoryLocks: input.finalFinancialEffects.unrelatedParentAdvisoryLocks
    },
    sessionsRemaining: input.sessionsRemaining,
    reentrantSharedLocks: input.reentrantSharedLocks,
    pausedRestaurantSqlstate: input.pausedRestaurantSqlstate,
    limitation: input.limitation
  };

  assertJsonSafe(report);
  const serialized = JSON.stringify(report);
  assert.equal(typeof serialized, 'string', 'cutover evidence must serialize to JSON');
  const roundTrip = JSON.parse(serialized);
  assert.deepEqual(roundTrip, report, 'cutover evidence must survive a JSON round trip');
  return roundTrip;
}
