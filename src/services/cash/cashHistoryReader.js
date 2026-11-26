// Read-only UI traversal. It must not advance the sync cursor, checkpoint a
// snapshot or reapply cash movements. The server orders sessions before movements.
export async function readCashSessionHistory({ fetchPage, scope, actorHandle, limit = 500 }) {
  let referenceChangeSeq = null;
  let pageCursor = null;
  let syncDeferred = false;
  const seen = new Set();
  const sessions = new Map();
  for (let page = 0; page < 10000; page += 1) {
    actorHandle.assertCurrent();
    const response = await fetchPage({ referenceChangeSeq, pageCursor });
    actorHandle.assertCurrent();
    if (response?.success !== true) {
      throw Object.assign(new Error(response?.message || response?.code || 'CASH_HISTORY_PAGE_FAILED'), {
        code: response?.code || 'CASH_HISTORY_PAGE_FAILED'
      });
    }
    if (response.snapshot_contract !== 'keyset_reference_v1'
      || response.snapshot_contract_version !== 1 || response.scope !== scope
      || !Number.isSafeInteger(response.snapshot_reference_change_seq)
      || response.snapshot_reference_change_seq < 0
      || !Number.isSafeInteger(response.safe_change_seq) || response.safe_change_seq < response.snapshot_reference_change_seq
      || typeof response.sync_deferred !== 'boolean' || response.limit !== limit
      || !Array.isArray(response.cash_sessions) || !Array.isArray(response.movements)
      || typeof response.has_more !== 'boolean'
      || response.snapshot_complete !== !response.has_more) {
      throw new Error('CASH_HISTORY_PAGE_INVALID');
    }
    if (referenceChangeSeq !== null && referenceChangeSeq !== response.snapshot_reference_change_seq) {
      throw new Error('CASH_HISTORY_REFERENCE_CHANGED');
    }
    referenceChangeSeq = response.snapshot_reference_change_seq;
    syncDeferred ||= response.sync_deferred === true || response.safe_change_seq !== referenceChangeSeq;
    const count = response.cash_sessions.length + response.movements.length;
    const next = response.next_page_cursor;
    const key = JSON.stringify(next);
    if (count > limit || (response.has_more && count !== limit)
      || (response.has_more ? (!next || typeof next !== 'object' || Array.isArray(next) || seen.has(key)) : next !== null)) {
      throw new Error('CASH_HISTORY_CURSOR_INVALID');
    }
    for (const session of response.cash_sessions) {
      if (!session?.id || sessions.has(session.id)
        || (scope === 'mine' && session.actor_key !== actorHandle.actorKey)) {
        throw new Error('CASH_HISTORY_SESSION_INVALID');
      }
      sessions.set(session.id, session);
    }
    // The V2 SQL returns rank 1 (sessions), then rank 2 (movements).
    // Once a movement is encountered, no further sessions can be present.
    if (!response.has_more || response.movements.length > 0) {
      actorHandle.assertCurrent();
      return { sessions: [...sessions.values()], referenceChangeSeq, syncDeferred };
    }
    if (response.cash_sessions.length === 0) {
      throw new Error('CASH_HISTORY_CURSOR_INVALID');
    }
    seen.add(key);
    pageCursor = next;
  }
  throw new Error('CASH_HISTORY_PAGE_LIMIT');
}
