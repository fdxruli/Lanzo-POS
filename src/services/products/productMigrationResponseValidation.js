const RESULT_COLLECTIONS = Object.freeze([
  ['category', 'categories', 'category'],
  ['product', 'products', 'product'],
  ['product_batch', 'batches', 'batch']
]);

const asObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

const getEntityPayload = (result, singularKey) => (
  result?.[singularKey]
  || result?.server_payload
  || result?.serverPayload
  || null
);

const getEntityId = (result, singularKey) => {
  const payload = getEntityPayload(result, singularKey);
  return result?.id
    || result?.entity_id
    || result?.entityId
    || payload?.id
    || null;
};

const getServerVersion = (result, singularKey) => {
  const payload = getEntityPayload(result, singularKey);
  return result?.server_version
    ?? result?.serverVersion
    ?? payload?.server_version
    ?? payload?.serverVersion
    ?? null;
};

const buildIssue = ({ entityType = null, entityId = null, code, message, result = null, singularKey = null }) => ({
  type: 'PRODUCT_MIGRATION_NESTED_RESULT_FAILED',
  entityType,
  entityId,
  code,
  message,
  serverVersion: singularKey ? getServerVersion(result, singularKey) : null,
  serverPayload: singularKey ? getEntityPayload(result, singularKey) : null
});

export const validateMigrationBatchResponse = ({ response, expectedCounts = {} } = {}) => {
  const issues = [];

  if (!asObject(response)) {
    return [{
      type: 'PRODUCT_MIGRATION_RESPONSE_INVALID',
      entityType: null,
      entityId: null,
      code: 'PRODUCT_MIGRATION_RESPONSE_INVALID',
      message: 'La respuesta de migracion no es un objeto valido.',
      serverVersion: null,
      serverPayload: null
    }];
  }

  if (response.success === false) {
    issues.push({
      type: 'PRODUCT_MIGRATION_RPC_FAILED',
      entityType: null,
      entityId: null,
      code: response.code || 'PRODUCT_MIGRATION_RPC_FAILED',
      message: response.message || 'El RPC de migracion fallo.',
      serverVersion: response.server_version ?? response.serverVersion ?? null,
      serverPayload: response.server_payload ?? response.serverPayload ?? null
    });
    return issues;
  }

  const results = asObject(response.results) ? response.results : null;

  for (const [entityType, collectionKey, singularKey] of RESULT_COLLECTIONS) {
    const expectedCount = Number(expectedCounts[collectionKey] || 0);
    const collection = results?.[collectionKey];

    if (!Array.isArray(collection)) {
      if (expectedCount > 0) {
        issues.push(buildIssue({
          entityType,
          code: 'PRODUCT_MIGRATION_RESULTS_MISSING',
          message: `La respuesta no contiene results.${collectionKey} para todos los registros procesados.`
        }));
      }
      continue;
    }

    if (collection.length !== expectedCount) {
      issues.push(buildIssue({
        entityType,
        code: 'PRODUCT_MIGRATION_RESULTS_COUNT_MISMATCH',
        message: `La respuesta contiene ${collection.length} resultados ${entityType}; se esperaban ${expectedCount}.`
      }));
    }

    collection.forEach((result, index) => {
      if (result?.success === true) return;

      issues.push(buildIssue({
        entityType,
        entityId: getEntityId(result, singularKey),
        code: result?.code || 'PRODUCT_MIGRATION_NESTED_RESULT_FAILED',
        message: result?.message || `El resultado ${entityType} en posicion ${index} no fue exitoso.`,
        result,
        singularKey
      }));
    });
  }

  return issues;
};

export default validateMigrationBatchResponse;
