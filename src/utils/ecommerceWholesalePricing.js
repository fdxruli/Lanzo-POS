import Big from 'big.js';

const asArray = (value) => (Array.isArray(value) ? value : []);
const asFinite = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

export const normalizeEcommerceWholesaleTiers = (
  tiers,
  { replacementCost = 0 } = {}
) => {
  const cost = Math.max(0, asFinite(replacementCost) ?? 0);
  const seen = new Set();
  const warnings = [];
  const normalized = [];

  asArray(tiers).forEach((tier) => {
    if (!tier || typeof tier !== 'object' || Array.isArray(tier)) {
      warnings.push('WHOLESALE_TIER_INVALID');
      return;
    }
    const minQuantity = asFinite(tier.minQuantity ?? tier.min_quantity ?? tier.min);
    const unitPrice = asFinite(tier.unitPrice ?? tier.unit_price ?? tier.price);
    if (
      !Number.isInteger(minQuantity)
      || minQuantity <= 0
      || unitPrice === null
      || unitPrice < 0
    ) {
      warnings.push('WHOLESALE_TIER_INVALID');
      return;
    }
    if (seen.has(minQuantity)) {
      warnings.push('WHOLESALE_TIER_DUPLICATE_QUANTITY');
      return;
    }
    seen.add(minQuantity);
    const belowCost = cost > 0 && unitPrice < cost;
    if (belowCost) warnings.push('WHOLESALE_TIER_BELOW_COST');
    normalized.push({
      sourceTierRef: String(
        tier.sourceTierRef
        ?? tier.source_tier_ref
        ?? `min:${minQuantity}`
      ).slice(0, 160),
      minQuantity,
      unitPrice: Number(unitPrice.toFixed(2)),
      sourceAvailable: !belowCost,
      warningCode: belowCost ? 'WHOLESALE_TIER_BELOW_COST' : null
    });
  });

  normalized.sort((left, right) => left.minQuantity - right.minQuantity);
  return {
    tiers: normalized.map((tier, displayOrder) => ({ ...tier, displayOrder })),
    warnings: Array.from(new Set(warnings)),
    valid: normalized.some((tier) => tier.sourceAvailable)
  };
};

export const resolveEcommerceUnitPrice = ({
  baseUnitPrice,
  quantity,
  wholesaleEnabled = false,
  tiers = [],
  variantAdjustment = 0,
  optionsAdjustment = 0
} = {}) => {
  const basePrice = Math.max(0, asFinite(baseUnitPrice) ?? 0);
  const variantDelta = asFinite(variantAdjustment) ?? 0;
  const optionsDelta = asFinite(optionsAdjustment) ?? 0;
  const integerQuantity = Math.max(1, Math.floor(asFinite(quantity) ?? 1));
  const finish = ({
    pricingMode,
    pricingBase,
    wholesaleMinQuantity = null,
    wholesaleTierRef = null
  }) => {
    const finalUnitPrice = Math.max(0, Number(
      new Big(pricingBase)
        .plus(variantDelta)
        .plus(optionsDelta)
        .round(2)
        .toFixed(2)
    ));
    return {
      pricingMode,
      baseUnitPrice: basePrice,
      wholesaleBaseUnitPrice: pricingMode === 'wholesale' ? pricingBase : null,
      variantAdjustment: Number(new Big(variantDelta).round(2).toFixed(2)),
      optionsAdjustment: Number(new Big(optionsDelta).round(2).toFixed(2)),
      appliedUnitPrice: finalUnitPrice,
      wholesaleMinQuantity,
      wholesaleTierRef
    };
  };
  if (!wholesaleEnabled) {
    return finish({
      pricingMode: 'standard',
      pricingBase: basePrice
    });
  }
  const applicable = asArray(tiers)
    .filter((tier) => (
      tier?.sourceAvailable !== false
      && tier?.isAvailable !== false
      && Number(tier?.minQuantity ?? tier?.min_quantity) <= integerQuantity
    ))
    .sort((left, right) => (
      Number(right?.minQuantity ?? right?.min_quantity)
      - Number(left?.minQuantity ?? left?.min_quantity)
    ))[0];
  if (!applicable) {
    return finish({
      pricingMode: 'standard',
      pricingBase: basePrice
    });
  }
  return finish({
    pricingMode: 'wholesale',
    pricingBase: Math.max(0, Number(
      applicable.unitPrice ?? applicable.unit_price
    ) || 0),
    wholesaleMinQuantity: Number(
      applicable.minQuantity ?? applicable.min_quantity
    ),
    wholesaleTierRef: applicable.sourceTierRef
      ?? applicable.source_tier_ref
      ?? null
  });
};
