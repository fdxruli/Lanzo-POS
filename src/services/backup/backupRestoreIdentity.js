import { createTenantFingerprint } from './backupFormat';
import { areLocalTenantAliasesCompatible, isTenantWorkerDatabaseName } from '../tenant/localTenantPolicy';

const permits = new WeakMap();

// Only one verified alias of each supported kind is unambiguous. Never derive
// candidates from file metadata, unverified aliases or contradictory bindings.
const checkedAliases = (values) => {
  if (!Array.isArray(values) || values.length === 0) throw new Error('BACKUP_TENANT_MISMATCH');
  const aliases = [...new Set(values)];
  const ids = aliases.filter((value) => typeof value === 'string' && /^license-id:\S+$/.test(value));
  const keys = aliases.filter((value) => typeof value === 'string' && /^license-key-sha256:[a-f0-9]{64}$/.test(value));
  if (ids.length > 1 || keys.length > 1 || ids.length + keys.length !== aliases.length) {
    throw new Error('BACKUP_TENANT_MISMATCH');
  }
  return aliases;
};

export async function validateV2RestoreIdentity(header, context, binding) {
  if (header.version !== 2 || !isTenantWorkerDatabaseName(context?.databaseName)) {
    throw new Error('BACKUP_TENANT_MISMATCH');
  }
  const aliases = checkedAliases(context.tenantAliases);
  const bound = checkedAliases(binding?.tenantAliases || [binding?.tenantIdentity]);
  if (!bound.includes(binding?.tenantIdentity) || !areLocalTenantAliasesCompatible(bound, aliases)) {
    throw new Error('BACKUP_TENANT_MISMATCH');
  }
  // The full current set and its singleton historical configurations are the
  // only candidates (at most three). No reverse alias enrichment is inferred.
  const candidates = aliases.length === 1 ? [aliases] : [aliases, ...aliases.map((alias) => [alias])];
  const fingerprints = await Promise.all(candidates.map(createTenantFingerprint));
  if (fingerprints.filter((value) => value === header.tenantFingerprint).length !== 1) {
    throw new Error('BACKUP_TENANT_MISMATCH');
  }
}

// Issued only by the authenticated worker flow after inspecting the decrypted
// archive. Bound to that immutable Blob and both physical names; a boolean or
// caller-supplied source name cannot bypass the default same-database guard.
export async function authorizePortableV2Restore(blob, header, context, binding, sourceDatabaseName) {
  await validateV2RestoreIdentity(header, context, binding);
  if (!isTenantWorkerDatabaseName(sourceDatabaseName)) throw new Error('BACKUP_DATABASE_MISMATCH');
  const permit = Object.freeze({});
  permits.set(permit, { blob, sourceDatabaseName, targetDatabaseName: context.databaseName });
  return permit;
}

export function assertPortableV2Restore(permit, blob, sourceDatabaseName, targetDatabaseName) {
  const verified = permit && permits.get(permit);
  if (!verified || verified.blob !== blob || verified.sourceDatabaseName !== sourceDatabaseName
    || verified.targetDatabaseName !== targetDatabaseName) throw new Error('BACKUP_DATABASE_MISMATCH');
}
