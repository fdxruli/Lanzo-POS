import { describe, expect, it } from 'vitest';
import {
  RECOVERY_DESTINATION_ACTION,
  RECOVERY_ROW_CLASSIFICATION
} from '../localTenantRecoveryPolicy';
import {
  createRecoveryCopyManifest,
  createRecoveryPlanExecutionProjection
} from '../localTenantRecoveryCopyManifest';

const basePlan = (overrides = {}) => ({
  version: 1,
  sourceSnapshotFingerprint: 'sha256:source',
  recoveryContextFingerprint: 'sha256:context',
  provenDirect: [],
  provenRelational: [],
  cloudReconciliationRequired: [],
  ambiguous: [],
  foreign: [],
  derivedRecompute: [],
  quarantined: [],
  ...overrides
});

const row = (ref, store, destinationAction, tier = 'TIER_D') => ({ ref, store, destinationAction, tier });

describe('deterministic recovery copy manifest', () => {
  it('includes only proven direct or relational COPY_IF_PROVEN rows', async () => {
    const plan = basePlan({
      provenDirect: [
        row('ref-direct', 'menu', RECOVERY_DESTINATION_ACTION.COPY_IF_PROVEN),
        row('ref-outbox', 'sync_outbox', RECOVERY_DESTINATION_ACTION.QUARANTINE, 'TIER_A')
      ],
      provenRelational: [row('ref-relational', 'product_batches', RECOVERY_DESTINATION_ACTION.COPY_IF_PROVEN)],
      cloudReconciliationRequired: [row('ref-cloud', 'sales', RECOVERY_DESTINATION_ACTION.COPY_IF_PROVEN)],
      ambiguous: [row('ref-ambiguous', 'customers', RECOVERY_DESTINATION_ACTION.COPY_IF_PROVEN)],
      foreign: [row('ref-foreign', 'menu', RECOVERY_DESTINATION_ACTION.COPY_IF_PROVEN)],
      derivedRecompute: [row('ref-stats', 'daily_stats', RECOVERY_DESTINATION_ACTION.RECOMPUTE)],
      quarantined: [row('ref-vault', 'sync_meta', RECOVERY_DESTINATION_ACTION.PRESERVE_VAULT)]
    });
    const manifest = await createRecoveryCopyManifest({
      recoveryPlan: plan, destinationSchemaFingerprint: 'sha256:schema'
    });

    expect(manifest.copyItems.map((item) => item.ref)).toEqual(['ref-direct', 'ref-relational']);
    expect(manifest.copyItemCount).toBe(2);
    expect(manifest.recomputeSummary).toEqual({ daily_stats: 1 });
    expect(manifest.copyItems.some((item) => item.store === 'sync_outbox')).toBe(false);
  });

  it('is deterministic independent of RecoveryPlan row ordering', async () => {
    const rows = [
      row('ref-b', 'menu', RECOVERY_DESTINATION_ACTION.COPY_IF_PROVEN),
      row('ref-a', 'categories', RECOVERY_DESTINATION_ACTION.COPY_IF_PROVEN)
    ];
    const first = basePlan({ provenDirect: rows });
    const second = basePlan({ provenDirect: [...rows].reverse() });
    const [left, right] = await Promise.all([
      createRecoveryCopyManifest({ recoveryPlan: first, destinationSchemaFingerprint: 'sha256:schema' }),
      createRecoveryCopyManifest({ recoveryPlan: second, destinationSchemaFingerprint: 'sha256:schema' })
    ]);
    expect(left.copyItems).toEqual(right.copyItems);
    expect(left.copyItemsByStore).toEqual(right.copyItemsByStore);
    expect(left.manifestFingerprint).toBe(right.manifestFingerprint);
  });

  it('fails closed on colliding opaque refs or revalidated policy drift', async () => {
    await expect(createRecoveryCopyManifest({
      recoveryPlan: basePlan({ provenDirect: [
        row('same-ref', 'menu', RECOVERY_DESTINATION_ACTION.COPY_IF_PROVEN),
        row('same-ref', 'customers', RECOVERY_DESTINATION_ACTION.COPY_IF_PROVEN)
      ] }),
      destinationSchemaFingerprint: 'sha256:schema'
    })).rejects.toMatchObject({ code: 'RECOVERY_COPY_REF_COLLISION' });

    const plan = basePlan({ provenDirect: [row('ref-a', 'menu', RECOVERY_DESTINATION_ACTION.COPY_IF_PROVEN)] });
    await expect(createRecoveryCopyManifest({
      recoveryPlan: plan,
      revalidatedPlan: basePlan({ ambiguous: [row('ref-a', 'menu', RECOVERY_DESTINATION_ACTION.COPY_IF_PROVEN)] }),
      destinationSchemaFingerprint: 'sha256:schema'
    })).rejects.toMatchObject({ code: 'RECOVERY_COPY_PLAN_POLICY_CHANGED' });
  });

  it('keeps the projection strictly redacted', () => {
    const projection = createRecoveryPlanExecutionProjection(basePlan({
      provenDirect: [row('opaque-ref', 'menu', RECOVERY_DESTINATION_ACTION.COPY_IF_PROVEN)]
    }));
    expect(projection[0]).toEqual({
      ref: 'opaque-ref',
      store: 'menu',
      classification: RECOVERY_ROW_CLASSIFICATION.PROVEN_DIRECT,
      destinationAction: RECOVERY_DESTINATION_ACTION.COPY_IF_PROVEN,
      tier: 'TIER_D'
    });
  });
});
