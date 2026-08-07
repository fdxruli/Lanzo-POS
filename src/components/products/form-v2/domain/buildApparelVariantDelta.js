const text = (value) => String(value ?? '').trim();

const number = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const comparable = (variant) => ({
  talla: text(variant?.talla),
  color: text(variant?.color),
  sku: text(variant?.sku),
  cost: number(variant?.cost),
  price: number(variant?.price)
});

const sameVariant = (original, next) => {
  const left = comparable(original);
  const right = comparable(next);
  return Object.keys(left).every((key) => left[key] === right[key]);
};

const responseBatch = (applied = {}) => (
  applied.batch
  || applied.result?.response?.batch
  || applied.result?.response?.batches?.find((batch) => batch?.id === applied.variant?.id)
  || null
);

const serverVersion = (batch = {}) => {
  const value = batch.serverVersion ?? batch.server_version;
  return Number.isFinite(Number(value)) ? Number(value) : null;
};

/** Rebuilds the form baseline from cloud-confirmed apparel operations. */
export function rebaseApparelVariantSnapshot(originalBatches = [], nextVariants = [], applied = {}) {
  const rebased = new Map(
    originalBatches.filter((batch) => batch?.id).map((batch) => [batch.id, { ...batch }])
  );
  const nextById = new Map(
    nextVariants.filter((variant) => variant?.id).map((variant) => [variant.id, variant])
  );

  for (const removed of applied.removed || []) rebased.delete(removed.variant?.id || removed.id);

  for (const operation of ['updated', 'created']) {
    for (const appliedVariant of applied[operation] || []) {
      const batch = responseBatch(appliedVariant);
      const variant = nextById.get(batch?.id || appliedVariant.variant?.id) || appliedVariant.variant;
      const version = serverVersion(batch);
      if (!variant?.id || version === null) continue;

      rebased.set(variant.id, {
        ...variant,
        serverVersion: version,
        createdAt: batch?.createdAt || batch?.created_at || variant.createdAt,
        talla: batch?.attributes?.talla ?? variant.talla ?? '',
        color: batch?.attributes?.color ?? variant.color ?? '',
        sku: batch?.sku ?? variant.sku ?? '',
        cost: batch?.cost ?? variant.cost,
        price: batch?.price ?? variant.price
      });
    }
  }

  return [...rebased.values()];
}

/** Catalog edits do not change inventory for an existing apparel batch. */
export function buildApparelVariantDelta(originalBatches = [], nextVariants = []) {
  const originalsById = new Map(
    originalBatches.filter((batch) => batch?.id).map((batch) => [batch.id, batch])
  );
  const seenExistingIds = new Set();
  const delta = { unchanged: [], updated: [], created: [], removed: [] };

  for (const variant of nextVariants.filter((row) => row?.talla && row?.color)) {
    const original = originalsById.get(variant.id);
    if (!original) {
      delta.created.push(variant);
      continue;
    }
    seenExistingIds.add(variant.id);
    (sameVariant(original, variant) ? delta.unchanged : delta.updated)
      .push({ ...variant, existingBatch: original });
  }

  for (const original of originalsById.values()) {
    if (!seenExistingIds.has(original.id)) delta.removed.push(original);
  }
  return delta;
}
