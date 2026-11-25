import { actorRuntimeController } from '../auth/actorRuntimeController';
import { syncMetaService } from './syncMetaService';

export const DURABLE_SNAPSHOT_VERSION = 1;

const META_KEY_PREFIX = 'initial_snapshot_v1:';
const activeSnapshotStates = new Set(['in_progress', 'snapshot_complete']);

const stableValue = (value) => JSON.stringify(value ?? null);
const snapshotCursorKey = (cursor) => stableValue(cursor);
const markerKey = (streamKey, contextId) => {
  // Keep one resumable traversal per authority/scope context. A changed actor
  // or permission set must not inherit another context's opaque page cursor.
  const value = String(contextId || '');
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ (code + index), 0x85ebca6b);
  }
  const suffix = `${(first >>> 0).toString(36)}${(second >>> 0).toString(36)}`;
  return `${META_KEY_PREFIX}${streamKey}:${suffix}`;
};

const persistMarker = async (key, marker, licenseKey) => {
  if (!await syncMetaService.setMeta(key, marker, { licenseKey })) {
    throw new Error('POS_SYNC_SNAPSHOT_CHECKPOINT_FAILED');
  }
};

export const buildSnapshotContextId = ({ licenseKey, streamKey, scope = null, actorHandle = null } = {}) => {
  actorHandle?.assertCurrent?.();
  const actor = actorRuntimeController.getState();
  actorHandle?.assertCurrent?.();
  return stableValue({
    version: DURABLE_SNAPSHOT_VERSION,
    licenseKey: licenseKey || null,
    streamKey: streamKey || null,
    scope,
    actor: {
      actorKey: actor.actorKey || null,
      actorType: actor.actorType || null,
      sessionId: actor.sessionId || null,
      tenantId: actor.tenant?.opaqueId || null,
      deviceRef: actor.deviceRef || null,
      permissions: [...(actor.permissions || [])].sort()
    }
  });
};

export const durableSnapshotService = {
  async getState({ licenseKey, streamKey, contextId } = {}) {
    if (!licenseKey || !streamKey) return null;
    return syncMetaService.getMeta(markerKey(streamKey, contextId), null, { licenseKey });
  },

  async isActive({ licenseKey, streamKey, contextId } = {}) {
    const marker = await this.getState({ licenseKey, streamKey, contextId });
    return Boolean(marker
      && marker.version === DURABLE_SNAPSHOT_VERSION
      && marker.contextId === contextId
      && activeSnapshotStates.has(marker.status));
  },

  async runConsistentSnapshot({
    licenseKey,
    streamKey,
    contextId,
    fetchPage,
    applyPage,
    actorHandle = null,
    cursorKey = null,
    advanceCursor = true,
    maxPages = 10_000
  } = {}) {
    if (!licenseKey || !streamKey || !contextId
      || typeof fetchPage !== 'function' || typeof applyPage !== 'function') {
      throw new Error('POS_SYNC_SNAPSHOT_ARGUMENTS_INVALID');
    }

    const key = markerKey(streamKey, contextId);
    let marker = await syncMetaService.getMeta(key, null, { licenseKey });
    if (marker?.version === DURABLE_SNAPSHOT_VERSION && marker.contextId === contextId
      && marker.status === 'complete' && marker.protocol === 'keyset_reference_v1'
      && marker.snapshotContractVersion === 1) {
      return {
        success: true,
        skipped: true,
        alreadyComplete: true,
        referenceChangeSeq: marker.referenceChangeSeq,
        pages: marker.pages || 0,
        syncDeferred: marker.syncDeferred === true
      };
    }

    if (marker?.version === DURABLE_SNAPSHOT_VERSION && marker.contextId === contextId
      && marker.protocol === 'keyset_reference_v1' && marker.snapshotContractVersion === 1
      && marker.status === 'recovery_pending') {
      return {
        success: true,
        skipped: true,
        snapshotComplete: true,
        recoveryPending: true,
        referenceChangeSeq: marker.referenceChangeSeq,
        pages: marker.pages || 0,
        syncDeferred: marker.syncDeferred === true
      };
    }

    const resumable = marker?.version === DURABLE_SNAPSHOT_VERSION
      && marker.contextId === contextId
      && marker.protocol === 'keyset_reference_v1'
      && (marker.snapshotContractVersion === null || marker.snapshotContractVersion === 1)
      && ['in_progress', 'snapshot_complete'].includes(marker.status);
    if (!resumable) {
      marker = {
        version: DURABLE_SNAPSHOT_VERSION,
        protocol: 'keyset_reference_v1',
        contextId,
        status: 'in_progress',
        snapshotContractVersion: null,
        referenceChangeSeq: null,
        pageCursor: null,
        pages: 0,
        applied: 0,
        syncDeferred: false,
        startedAt: new Date().toISOString()
      };
      await persistMarker(key, marker, licenseKey);
    }

    if (marker.status === 'snapshot_complete') {
      return this._finishSnapshot({
        key, marker, licenseKey, cursorKey, advanceCursor, actorHandle
      });
    }

    let pages = Number(marker.pages) || 0;
    let applied = Number(marker.applied) || 0;
    let referenceChangeSeq = marker.referenceChangeSeq;
    let pageCursor = marker.pageCursor ?? null;
    let syncDeferred = marker.syncDeferred === true;
    let previousCursorKey = pageCursor === null ? null : snapshotCursorKey(pageCursor);

    while (pages < maxPages) {
      actorHandle?.assertCurrent?.();
      const response = await fetchPage({
        referenceChangeSeq,
        pageCursor,
        firstPage: pages === 0
      });
      actorHandle?.assertCurrent?.();

      if (!response || response.success === false) {
        const error = new Error(response?.code || response?.message || 'POS_SYNC_SNAPSHOT_PAGE_FAILED');
        error.code = response?.code || 'POS_SYNC_SNAPSHOT_PAGE_FAILED';
        error.retryable = response?.retryable === true || error.code === 'RPC_RATE_LIMITED';
        error.retryAfterSeconds = Number(response?.retry_after_seconds ?? response?.retryAfterSeconds) || null;
        error.response = response;
        throw error;
      }
      if (response.snapshot_contract !== 'keyset_reference_v1'
        || response.snapshot_contract_version !== 1) {
        throw new Error('POS_SYNC_SNAPSHOT_CONTRACT_INVALID');
      }
      if (marker.snapshotContractVersion !== null
        && marker.snapshotContractVersion !== undefined
        && marker.snapshotContractVersion !== response.snapshot_contract_version) {
        throw new Error('POS_SYNC_SNAPSHOT_CONTRACT_CHANGED');
      }
      const responseReference = response.snapshot_reference_change_seq;
      if (typeof responseReference !== 'number'
        || !Number.isSafeInteger(responseReference) || responseReference < 0) {
        throw new Error('POS_SYNC_SNAPSHOT_REFERENCE_INVALID');
      }
      if (referenceChangeSeq === null) referenceChangeSeq = responseReference;
      else if (responseReference !== referenceChangeSeq) {
        throw new Error('POS_SYNC_SNAPSHOT_REFERENCE_CHANGED');
      }

      if (typeof response.has_more !== 'boolean' || typeof response.snapshot_complete !== 'boolean') {
        throw new Error('POS_SYNC_SNAPSHOT_COMPLETION_INVALID');
      }
      const hasMore = response.has_more;
      const complete = response.snapshot_complete;
      const nextCursor = response.next_page_cursor ?? response.nextPageCursor ?? null;
      if (hasMore && (nextCursor === null || snapshotCursorKey(nextCursor) === previousCursorKey)) {
        throw new Error('POS_SYNC_SNAPSHOT_CURSOR_INVALID');
      }
      if (hasMore && complete) throw new Error('POS_SYNC_SNAPSHOT_COMPLETION_CONTRADICTS_CURSOR');
      if (!hasMore && !complete) throw new Error('POS_SYNC_SNAPSHOT_INCOMPLETE');

      const outcome = await applyPage(response);
      actorHandle?.assertCurrent?.();
      if (outcome === false || outcome?.complete === false || outcome?.blocked === true
        || Number(outcome?.rejected || 0) > 0 || Number(outcome?.deferred || 0) > 0) {
        throw new Error(outcome?.code || 'POS_SYNC_SNAPSHOT_LOCAL_APPLY_INCOMPLETE');
      }

      const pageApplied = Number(outcome?.applied) || 0;
      pages += 1;
      applied += pageApplied;
      syncDeferred = syncDeferred || response.sync_deferred === true || response.syncDeferred === true;

      if (hasMore && pageApplied === 0) {
        const responseRows = Number(outcome?.rowCount);
        if (!Number.isSafeInteger(responseRows) || responseRows <= 0) {
          throw new Error('POS_SYNC_SNAPSHOT_EMPTY_PAGE');
        }
      }

      marker = {
        ...marker,
        status: hasMore ? 'in_progress' : 'snapshot_complete',
        snapshotContractVersion: response.snapshot_contract_version,
        referenceChangeSeq,
        pageCursor: hasMore ? nextCursor : null,
        pages,
        applied,
        syncDeferred,
        updatedAt: new Date().toISOString()
      };
      await persistMarker(key, marker, licenseKey);
      if (!hasMore) break;

      pageCursor = nextCursor;
      previousCursorKey = snapshotCursorKey(pageCursor);
    }

    if (marker.status !== 'snapshot_complete') throw new Error('POS_SYNC_SNAPSHOT_PAGE_LIMIT');
    return this._finishSnapshot({
      key, marker, licenseKey, cursorKey, advanceCursor, actorHandle
    });
  },

  async _finishSnapshot({ key, marker, licenseKey, cursorKey, advanceCursor, actorHandle }) {
    actorHandle?.assertCurrent?.();
    if (advanceCursor && cursorKey && Number.isSafeInteger(marker.referenceChangeSeq)) {
      const advanced = await syncMetaService.advanceMeta(cursorKey, marker.referenceChangeSeq, { licenseKey });
      if (!Number.isSafeInteger(advanced) || advanced < marker.referenceChangeSeq) {
        throw new Error('POS_SYNC_SNAPSHOT_CURSOR_PERSIST_FAILED');
      }
    }
    actorHandle?.assertCurrent?.();

    const recoveryPending = {
      ...marker,
      status: 'recovery_pending',
      snapshotCompletedAt: marker.snapshotCompletedAt || new Date().toISOString()
    };
    await persistMarker(key, recoveryPending, licenseKey);
    return {
      success: true,
      snapshotComplete: true,
      recoveryPending: true,
      applied: Number(recoveryPending.applied) || 0,
      referenceChangeSeq: recoveryPending.referenceChangeSeq,
      pages: Number(recoveryPending.pages) || 0,
      syncDeferred: recoveryPending.syncDeferred === true
    };
  },

  async getRecoveryStartSeq({ licenseKey, streamKey, contextId, cursorKey, fallback = 0 } = {}) {
    const marker = await this.getState({ licenseKey, streamKey, contextId });
    const current = Number(await syncMetaService.getMeta(cursorKey, fallback, { licenseKey })) || 0;
    if (marker?.contextId === contextId && marker.protocol === 'keyset_reference_v1'
      && marker.snapshotContractVersion === 1 && marker.status === 'recovery_pending'
      && Number.isSafeInteger(marker.referenceChangeSeq)) {
      return Math.min(current, marker.referenceChangeSeq);
    }
    return current;
  },

  async completeRecovery({
    licenseKey, streamKey, contextId, cursorKey, latestChangeSeq, hasMore = false, syncDeferred = false
  } = {}) {
    const key = markerKey(streamKey, contextId);
    const marker = await syncMetaService.getMeta(key, null, { licenseKey });
    if (!marker || marker.contextId !== contextId || marker.protocol !== 'keyset_reference_v1'
      || marker.snapshotContractVersion !== 1 || marker.status !== 'recovery_pending') return null;
    const durableCursor = Number(await syncMetaService.getMeta(cursorKey, null, { licenseKey }));

    const nextMarker = {
      ...marker,
      syncDeferred: syncDeferred === true,
      lastRecoveryChangeSeq: Number.isSafeInteger(Number(latestChangeSeq)) ? Number(latestChangeSeq) : null,
      recoveryUpdatedAt: new Date().toISOString()
    };
    if (!syncDeferred && !hasMore
      && Number(latestChangeSeq) >= Number(marker.referenceChangeSeq)
      && Number.isSafeInteger(durableCursor)
      && durableCursor >= Number(marker.referenceChangeSeq)) {
      nextMarker.status = 'complete';
      nextMarker.completedAt = new Date().toISOString();
    }
    await persistMarker(key, nextMarker, licenseKey);
    return nextMarker.status === 'complete';
  }
};

export default durableSnapshotService;
