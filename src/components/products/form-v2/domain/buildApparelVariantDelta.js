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
