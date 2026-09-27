const MAX_REACTIVATION_CANDIDATES = 12;
const MAX_DORMANT_PRODUCTS = 20;
const MAX_CATEGORY_OPPORTUNITIES = 12;
const LOW_ACTIVITY_UNIT_THRESHOLD = 1;
const HIGH_CATEGORY_SHARE_THRESHOLD = 0.25;
const HIGH_CONCENTRATION_THRESHOLD = 0.6;

const asArray = (value) => (Array.isArray(value) ? value : []);
const asRecord = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : {});
const text = (value, fallback = '') => (typeof value === 'string' && value.trim() ? value.trim() : fallback);
const finiteNumber = (value) => {
  const number = Number(value);
  return value !== null && value !== undefined && value !== '' && Number.isFinite(number) ? number : null;
};
const normalizedName = (value) => text(value)
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/\s+/gu, ' ')
  .toLowerCase();
const stableId = (value) => (value === null || value === undefined ? '' : String(value).trim());
const isDeleted = (row) => Boolean(row?.deletedAt || row?.deletedTimestamp || row?.deleted_at || row?.deleted_timestamp);
const isActive = (row) => row?.isActive !== false && row?.is_active !== false && !isDeleted(row);
const periodIsComplete = (dataset) => (
  Boolean(dataset)
  && dataset?.metadata?.paginationComplete === true
  && dataset?.metadata?.sourceComplete === true
  && dataset?.metadata?.detailComplete === true
  && dataset?.metadata?.historyTruncated !== true
  && dataset?.metadata?.detailTruncated !== true
);

const makePeriodAccumulator = () => ({
  products: new Map(),
  categories: new Map(),
  totalNetSales: 0,
  totalUnits: 0,
  amountComplete: true,
  unmatchedLines: 0,
  ambiguousNameLines: 0,
  missingProductIdLines: 0,
  unmatchedCategoryLines: 0,
  categorizedNetSales: 0,
  lines: 0
});

const ensureAggregate = (map, key, makeValue) => {
  if (!map.has(key)) map.set(key, makeValue());
  return map.get(key);
};

const accumulatePeriod = ({ dataset, productsById, productsByName, categoriesById }) => {
  const aggregate = makePeriodAccumulator();
  const rows = asArray(dataset?.history?.rows);

  rows.forEach((sale) => {
    asArray(asRecord(sale).items).forEach((rawItem) => {
      const item = asRecord(rawItem);
      // `item.id` is often the sales-detail row id, not the catalogue product id.
      const productId = stableId(item.productId ?? item.product_id);
      const productName = text(item.name ?? item.productName ?? item.product_name, 'Producto sin nombre');
      let product = productId ? productsById.get(productId) : null;

      if (!product && !productId) {
        aggregate.missingProductIdLines += 1;
        const matches = productsByName.get(normalizedName(productName)) || [];
        if (matches.length === 1) product = matches[0];
        else if (matches.length > 1) aggregate.ambiguousNameLines += 1;
      }

      if (!product) {
        aggregate.unmatchedLines += 1;
        aggregate.unmatchedCategoryLines += 1;
      }

      const quantity = finiteNumber(item.quantity ?? item.qty);
      const netSales = finiteNumber(item.total ?? item.lineTotal ?? item.line_total ?? item.netSales ?? item.net_sales);
      aggregate.lines += 1;
      if (quantity === null) aggregate.totalUnits = null;
      else if (aggregate.totalUnits !== null) aggregate.totalUnits += quantity;
      if (netSales === null) aggregate.amountComplete = false;
      else {
        aggregate.totalNetSales += netSales;
        if (aggregate.totalNetSales < 0 && Math.abs(aggregate.totalNetSales) < 1e-9) aggregate.totalNetSales = 0;
      }

      if (!product) return;

      const productAggregate = ensureAggregate(aggregate.products, product.id, () => ({
        product,
        netSales: 0,
        units: 0,
        hasAmount: true,
        lineCount: 0
      }));
      productAggregate.lineCount += 1;
      if (netSales === null) productAggregate.hasAmount = false;
      else productAggregate.netSales += netSales;
      if (quantity !== null) productAggregate.units += quantity;

      const categoryId = stableId(product.categoryId ?? product.category_id);
      const category = categoryId ? categoriesById.get(categoryId) : null;
      if (!category) {
        aggregate.unmatchedCategoryLines += 1;
        return;
      }
      const categoryAggregate = ensureAggregate(aggregate.categories, categoryId, () => ({
        category,
        netSales: 0,
        units: 0,
        hasAmount: true,
        productIds: new Set(),
        lineCount: 0
      }));
      categoryAggregate.lineCount += 1;
      categoryAggregate.productIds.add(product.id);
      if (netSales === null) categoryAggregate.hasAmount = false;
      else {
        categoryAggregate.netSales += netSales;
        aggregate.categorizedNetSales += netSales;
      }
      if (quantity !== null) categoryAggregate.units += quantity;
    });
  });

  if (aggregate.totalUnits === null) aggregate.totalUnits = null;
  return aggregate;
};

const addUnique = (rows, row) => {
  if (!rows.some((existing) => existing.key === row.key)) rows.push(row);
};

const categorySignalScore = (signals) => {
  if (signals.includes('category_growing')) return 100;
  if (signals.includes('strong_category_few_products')) return 85;
  if (signals.includes('single_product_concentration')) return 75;
  if (signals.includes('many_unsold_products')) return 55;
  if (signals.includes('category_declining')) return 40;
  return 0;
};

const evidenceCandidate = ({ type, ref, entity, signal, recommendationType, strength, metrics, evidenceKeys }) => ({
  key: ref,
  type,
  focus: { type, key: ref },
  entity,
  signal: Array.isArray(signal) ? signal : [signal],
  recommendationType,
  strength,
  metrics,
  evidenceKeys
});

/**
 * Joins the tenant's current catalog against the complete sales detail used by
 * the sales agent. Product ids take precedence. Name fallback is used only when
 * exactly one catalog row has that normalized name; duplicate names stay
 * unmatched rather than combining distinct products.
 */
export const buildAssortmentAnalysis = ({ catalog, currentDataset, previousDataset = null } = {}) => {
  const catalogSource = asRecord(catalog);
  const rawProducts = asArray(catalogSource.products).filter((row) => stableId(asRecord(row).id));
  const rawCategories = asArray(catalogSource.categories).filter((row) => stableId(asRecord(row).id));
  const productsById = new Map();
  const productsByName = new Map();
  const categoriesById = new Map();

  rawCategories.forEach((rawCategory) => {
    const category = asRecord(rawCategory);
    const id = stableId(category.id);
    if (!id || !text(category.name)) return;
    categoriesById.set(id, {
      id,
      name: text(category.name),
      active: isActive(category)
    });
  });

  rawProducts.forEach((rawProduct) => {
    const source = asRecord(rawProduct);
    const id = stableId(source.id);
    const product = {
      id,
      name: text(source.name, 'Producto sin nombre'),
      categoryId: stableId(source.categoryId ?? source.category_id),
      active: isActive(source)
    };
    productsById.set(id, product);
    const nameKey = normalizedName(product.name);
    const sameName = productsByName.get(nameKey) || [];
    sameName.push(product);
    productsByName.set(nameKey, sameName);
  });

  const currentComplete = periodIsComplete(currentDataset);
  const previousComplete = periodIsComplete(previousDataset);
  const catalogComplete = catalogSource.complete === true
    && catalogSource.productsTruncated !== true
    && catalogSource.categoriesTruncated !== true;
  const current = accumulatePeriod({
    dataset: currentDataset,
    productsById,
    productsByName,
    categoriesById
  });
  const previous = previousComplete
    ? accumulatePeriod({ dataset: previousDataset, productsById, productsByName, categoriesById })
    : null;
  const comparisonAvailable = Boolean(previous && currentComplete);

  const activeProducts = Array.from(productsById.values()).filter((product) => product.active);
  const activeCategories = Array.from(categoriesById.values()).filter((category) => category.active);
  const soldActiveProductIds = new Set(Array.from(current.products.entries())
    .filter(([id, value]) => productsById.get(id)?.active && value.lineCount > 0)
    .map(([id]) => id));
  const soldCategoryIds = new Set(Array.from(current.categories.entries())
    .filter(([, value]) => value.lineCount > 0)
    .map(([id]) => id));

  const productSales = activeProducts.map((product) => {
    const now = current.products.get(product.id);
    const before = previous?.products.get(product.id);
    const nowSales = now?.hasAmount ? now.netSales : (now ? null : (currentComplete ? 0 : null));
    const beforeSales = before?.hasAmount ? before.netSales : (before ? null : (previousComplete ? 0 : null));
    const nowUnits = now ? now.units : (currentComplete ? 0 : null);
    const beforeUnits = before ? before.units : (previousComplete ? 0 : null);
    const previousActivity = before && (before.netSales > 0 || before.units > 0);
    const currentActivity = now && (now.netSales > 0 || now.units > 0);
    let activity = null;
    if (comparisonAvailable && previousActivity && !currentActivity) activity = 'previously_sold_now_inactive';
    else if (currentComplete && !currentActivity) activity = 'never_sold_in_window';
    else if (comparisonAvailable && previousActivity && currentActivity
      && ((nowSales !== null && beforeSales !== null && nowSales < beforeSales)
        || (nowUnits !== null && beforeUnits !== null && nowUnits < beforeUnits))) activity = 'declining';
    else if (currentComplete && currentActivity && nowUnits !== null && nowUnits <= LOW_ACTIVITY_UNIT_THRESHOLD) activity = 'low_activity';

    const category = categoriesById.get(product.categoryId) || null;
    return {
      product,
      category,
      currentSales: nowSales,
      previousSales: beforeSales,
      currentUnits: nowUnits,
      previousUnits: beforeUnits,
      currentLineCount: now?.lineCount || 0,
      previousLineCount: before?.lineCount || 0,
      activity,
      availability: activity && !currentActivity ? 'availability_unknown' : null
    };
  });

  const currentAmountComplete = currentComplete && current.amountComplete;
  const previousAmountComplete = comparisonAvailable && previous?.amountComplete === true;
  const categoryCoverageComplete = currentAmountComplete
    && current.unmatchedCategoryLines === 0
    && current.unmatchedLines === 0
    && current.ambiguousNameLines === 0;
  const productCoverageComplete = currentAmountComplete
    && current.unmatchedLines === 0
    && current.ambiguousNameLines === 0;
  const totalCurrentSales = currentAmountComplete ? current.totalNetSales : null;
  const productSalesRows = Array.from(current.products.values())
    .filter((entry) => entry.hasAmount && entry.netSales > 0)
    .sort((left, right) => right.netSales - left.netSales || left.product.name.localeCompare(right.product.name, 'es'));
  const categorySalesRows = Array.from(current.categories.entries())
    .map(([id, entry]) => ({ id, ...entry }))
    .filter((entry) => entry.hasAmount && entry.netSales > 0)
    .sort((left, right) => right.netSales - left.netSales || left.category.name.localeCompare(right.category.name, 'es'));
  const productDenominator = productCoverageComplete ? totalCurrentSales : null;
  const categoryDenominator = categoryCoverageComplete ? totalCurrentSales : null;
  const topProductShare = productDenominator > 0 && productSalesRows[0]
    ? productSalesRows[0].netSales / productDenominator
    : null;
  const top3ProductShare = productDenominator > 0
    ? productSalesRows.slice(0, 3).reduce((sum, row) => sum + row.netSales, 0) / productDenominator
    : null;
  const topCategoryShare = categoryDenominator > 0 && categorySalesRows[0]
    ? categorySalesRows[0].netSales / categoryDenominator
    : null;

  const activeCategoryProductCounts = new Map();
  const activeCategorySoldCounts = new Map();
  activeProducts.forEach((product) => {
    if (product.categoryId && categoriesById.get(product.categoryId)?.active) {
      activeCategoryProductCounts.set(product.categoryId, (activeCategoryProductCounts.get(product.categoryId) || 0) + 1);
      if (soldActiveProductIds.has(product.id)) {
        activeCategorySoldCounts.set(product.categoryId, (activeCategorySoldCounts.get(product.categoryId) || 0) + 1);
      }
    }
  });

  const categoryRows = Array.from(categoriesById.entries()).map(([id, category]) => {
    const now = current.categories.get(id);
    const before = previous?.categories.get(id);
    const activeProductCount = category.active ? (activeCategoryProductCounts.get(id) || 0) : 0;
    const soldProductCount = category.active ? (activeCategorySoldCounts.get(id) || 0) : 0;
    const unsoldProductCount = currentComplete && category.active ? activeProductCount - soldProductCount : null;
    const netSales = now?.hasAmount ? now.netSales : (now ? null : (currentAmountComplete ? 0 : null));
    const previousNetSales = before?.hasAmount ? before.netSales : (before ? null : (previousAmountComplete ? 0 : null));
    const salesShare = categoryDenominator > 0 && netSales !== null ? netSales / categoryDenominator : null;
    const productShares = now?.hasAmount && now.netSales > 0
      ? Array.from(now.productIds)
        .map((productId) => current.products.get(productId))
        .filter((entry) => entry?.hasAmount)
        .map((entry) => entry.netSales / now.netSales)
      : [];
    const productConcentration = productShares.length ? Math.max(...productShares) : null;
    const signals = [];
    if (comparisonAvailable && netSales !== null && previousNetSales !== null) {
      if (netSales > previousNetSales && previousNetSales > 0) signals.push('category_growing');
      else if (netSales > 0 && previousNetSales === 0) signals.push('new_category_activity');
      else if (netSales < previousNetSales) signals.push('category_declining');
    }
    if (salesShare !== null && salesShare >= HIGH_CATEGORY_SHARE_THRESHOLD && activeProductCount > 0 && activeProductCount <= 3) {
      signals.push('strong_category_few_products');
    }
    if (productConcentration !== null && productConcentration >= HIGH_CONCENTRATION_THRESHOLD) {
      signals.push('single_product_concentration');
    }
    if (unsoldProductCount !== null && activeProductCount >= 3 && unsoldProductCount / activeProductCount >= 0.5) {
      signals.push('many_unsold_products');
    }
    return {
      id,
      category,
      activeProductCount,
      soldProductCount,
      unsoldProductCount,
      netSales: currentAmountComplete ? netSales : null,
      previousNetSales: previousAmountComplete ? previousNetSales : null,
      units: currentComplete ? (now?.units ?? 0) : null,
      previousUnits: previousComplete ? (before?.units ?? 0) : null,
      salesDelta: currentAmountComplete && previousAmountComplete && netSales !== null && previousNetSales !== null
        ? netSales - previousNetSales
        : null,
      salesDeltaPercent: currentAmountComplete && previousAmountComplete && previousNetSales > 0 && netSales !== null
        ? (netSales - previousNetSales) / previousNetSales
        : null,
      salesShare: categoryDenominator !== null ? salesShare : null,
      productConcentration: categoryCoverageComplete ? productConcentration : null,
      signals
    };
  }).filter((row) => row.category.active || row.netSales > 0 || row.previousNetSales > 0);

  const categoryOpportunities = categoryRows
    .filter((row) => row.signals.length > 0)
    .sort((left, right) => categorySignalScore(right.signals) - categorySignalScore(left.signals)
      || (right.netSales || 0) - (left.netSales || 0)
      || left.category.name.localeCompare(right.category.name, 'es'))
    .slice(0, MAX_CATEGORY_OPPORTUNITIES);

  const reactivation = comparisonAvailable
    ? productSales.filter((row) => row.product.active
      && row.activity === 'previously_sold_now_inactive')
      .sort((left, right) => (right.previousSales || right.previousUnits || 0) - (left.previousSales || left.previousUnits || 0)
        || left.product.name.localeCompare(right.product.name, 'es'))
      .slice(0, MAX_REACTIVATION_CANDIDATES)
    : [];
  const dormantProducts = currentComplete
    ? productSales.filter((row) => row.activity === 'never_sold_in_window'
      || row.activity === 'previously_sold_now_inactive'
      || row.activity === 'low_activity'
      || row.activity === 'declining')
      .sort((left, right) => {
        const order = { previously_sold_now_inactive: 0, declining: 1, low_activity: 2, never_sold_in_window: 3 };
        return (order[left.activity] - order[right.activity])
          || (right.previousSales || 0) - (left.previousSales || 0)
          || left.product.name.localeCompare(right.product.name, 'es');
      })
      .slice(0, MAX_DORMANT_PRODUCTS)
    : [];

  const candidates = [];
  let productCandidateIndex = 0;
  reactivation.forEach((row) => {
    productCandidateIndex += 1;
    const ref = `product_candidate_${productCandidateIndex}`;
    row.candidateRef = ref;
    addUnique(candidates, evidenceCandidate({
      type: 'product',
      ref,
      entity: row.product.name,
      signal: ['previously_sold_now_inactive', 'availability_unknown'],
      recommendationType: 'investigation',
      strength: 'moderate',
      metrics: {
        currentSales: row.currentSales,
        previousSales: row.previousSales,
        currentUnits: row.currentUnits,
        previousUnits: row.previousUnits
      },
      evidenceKeys: [`assortment.product:${ref}`]
    }));
  });
  categoryOpportunities.forEach((row, index) => {
    const ref = `category_candidate_${index + 1}`;
    row.candidateRef = ref;
    addUnique(candidates, evidenceCandidate({
      type: 'category',
      ref,
      entity: row.category.name,
      signal: row.signals,
      recommendationType: row.signals.includes('category_declining') && row.signals.length === 1
        ? 'investigation'
        : 'growth_experiment',
      strength: row.signals.includes('category_growing') || row.signals.includes('strong_category_few_products')
        ? 'strong'
        : 'moderate',
      metrics: {
        currentSales: row.netSales,
        previousSales: row.previousNetSales,
        currentUnits: row.units,
        previousUnits: row.previousUnits,
        salesDelta: row.salesDelta,
        salesShare: row.salesShare,
        activeProducts: row.activeProductCount,
        soldProducts: row.soldProductCount,
        unsoldProducts: row.unsoldProductCount,
        topProductShare: row.productConcentration
      },
      evidenceKeys: [`assortment.category:${ref}`]
    }));
  });

  const narrativeCandidates = candidates.slice(0, 8);
  const actionCandidates = narrativeCandidates.filter((candidate) => candidate.strength === 'strong'
    || (candidate.type === 'product' && candidate.signal.includes('previously_sold_now_inactive')));
  const minimumUsefulRecommendations = Math.min(2, actionCandidates.length);
  const evidenceKeys = [];
  if (catalogComplete) evidenceKeys.push('assortment.metric:activeCatalogProducts');
  if (currentComplete) {
    evidenceKeys.push('assortment.metric:soldProducts', 'assortment.metric:unsoldProducts');
  }
  if (productCoverageComplete && topProductShare !== null) evidenceKeys.push('assortment.metric:topProductShare');
  if (productCoverageComplete && top3ProductShare !== null) evidenceKeys.push('assortment.metric:top3ProductShare');
  if (categoryCoverageComplete && topCategoryShare !== null) evidenceKeys.push('assortment.metric:topCategoryShare');
  narrativeCandidates.forEach((candidate) => evidenceKeys.push(...candidate.evidenceKeys));

  const limitations = [
    'El análisis usa el catálogo local del tenant activo y el historial de ventas permitido para este actor.',
    'No se confirmó la disponibilidad histórica de cada producto; la ausencia de ventas no demuestra falta de demanda.',
    'La señal de actividad baja usa un criterio simple: una unidad o menos en el periodo actual.',
    'No se usaron stock, costos, márgenes ni utilidades para calificar productos o categorías.',
    'Lanzo no puede confirmar demanda de productos o servicios que no existen en el catálogo ni en el historial.'
  ];
  if (!catalogComplete) limitations.push('No se pudo confirmar la lectura completa del catálogo; los conteos y la comparación de surtido son parciales.');
  if (!currentComplete) limitations.push('El detalle o la paginación de ventas del periodo actual está incompleto; no se clasifican productos sin venta como inactivos.');
  if (current.ambiguousNameLines > 0) limitations.push('Hay líneas sin productId cuyo nombre coincide con varios productos; se excluyeron de la relación por nombre.');
  else if (current.missingProductIdLines > 0) limitations.push('Algunas líneas sin productId se relacionaron por nombre exacto normalizado, sólo cuando existe un único producto coincidente.');
  if (current.unmatchedLines > 0) limitations.push('Hay líneas de venta que no se pudieron relacionar con el catálogo actual.');
  if (current.unmatchedCategoryLines > 0) limitations.push('Hay productos vendidos sin una categoría vigente verificable; no se asignaron a una categoría inventada.');
  if (!previousComplete) limitations.push('No hay una comparación anterior completa; no se presentan señales de crecimiento o caída.');
  if (previous && !currentComplete) limitations.push('La comparación entre periodos no se muestra porque el detalle del periodo actual está incompleto.');

  const soldProducts = soldActiveProductIds.size;
  const unsoldProducts = currentComplete ? Math.max(activeProducts.length - soldProducts, 0) : null;
  const soldCategories = Array.from(soldCategoryIds).filter((id) => categoriesById.has(id)).length;
  const narrativeEligible = Boolean(catalogComplete && currentComplete && candidates.length > 0
    && (categoryCoverageComplete || productCoverageComplete));

  return {
    version: 1,
    catalog: {
      source: 'local_tenant_catalog',
      complete: catalogComplete,
      productsRead: rawProducts.length,
      categoriesRead: rawCategories.length,
      productsTruncated: catalogSource.productsTruncated === true,
      categoriesTruncated: catalogSource.categoriesTruncated === true
    },
    health: {
      activeCatalogProducts: activeProducts.length,
      inactiveCatalogProducts: Array.from(productsById.values()).filter((product) => !product.active).length,
      soldProducts: currentComplete ? soldProducts : null,
      unsoldProducts,
      activeCategories: activeCategories.length,
      soldCategories: currentComplete ? soldCategories : null,
      currentSalesCoverageComplete: currentComplete,
      previousComparisonAvailable: comparisonAvailable,
      productSalesJoinCoverage: current.lines > 0 ? Math.max(0, (current.lines - current.unmatchedLines) / current.lines) : null,
      categorySalesCoverage: current.lines > 0 ? Math.max(0, (current.lines - current.unmatchedCategoryLines) / current.lines) : null,
      concentration: {
        topProductShare: productCoverageComplete ? topProductShare : null,
        top3ProductShare: productCoverageComplete ? top3ProductShare : null,
        topCategoryShare: categoryCoverageComplete ? topCategoryShare : null,
        categoryRevenueCoverage: currentAmountComplete && totalCurrentSales > 0
          ? current.categorizedNetSales / totalCurrentSales
          : null
      }
    },
    categoryPerformance: categoryRows
      .sort((left, right) => (right.netSales || 0) - (left.netSales || 0)
        || right.activeProductCount - left.activeProductCount
        || left.category.name.localeCompare(right.category.name, 'es'))
      .slice(0, 40)
      .map((row) => ({
        name: row.category.name,
        active: row.category.active,
        netSales: row.netSales,
        previousNetSales: row.previousNetSales,
        units: row.units,
        previousUnits: row.previousUnits,
        salesDelta: row.salesDelta,
        salesDeltaPercent: row.salesDeltaPercent,
        salesShare: row.salesShare,
        activeProducts: row.activeProductCount,
        soldProducts: row.soldProductCount,
        unsoldProducts: row.unsoldProductCount,
        topProductShare: row.productConcentration,
        signals: row.signals
      })),
    categoryOpportunities: categoryOpportunities.map((row) => ({
      candidateRef: row.candidateRef,
      name: row.category.name,
      active: row.category.active,
      signals: row.signals,
      currentSales: row.netSales,
      previousSales: row.previousNetSales,
      units: row.units,
      previousUnits: row.previousUnits,
      salesDelta: row.salesDelta,
      salesShare: row.salesShare,
      activeProducts: row.activeProductCount,
      soldProducts: row.soldProductCount,
      unsoldProducts: row.unsoldProductCount,
      topProductShare: row.productConcentration
    })),
    dormantProducts: dormantProducts.map((row) => ({
      candidateRef: row.candidateRef || null,
      name: row.product.name,
      category: row.category?.name || null,
      activity: row.activity,
      currentSales: row.currentSales,
      previousSales: row.previousSales,
      currentUnits: row.currentUnits,
      previousUnits: row.previousUnits,
      availability: row.availability
    })),
    reactivationCandidates: reactivation.map((row) => ({
      candidateRef: row.candidateRef,
      name: row.product.name,
      category: row.category?.name || null,
      activity: row.activity,
      currentSales: row.currentSales,
      previousSales: row.previousSales,
      currentUnits: row.currentUnits,
      previousUnits: row.previousUnits,
      reason: 'Tuvo ventas en el periodo anterior comparable y no registra ventas en el actual.',
      availability: 'availability_unknown'
    })),
    opportunityCandidates: narrativeCandidates,
    evidenceKeys: Array.from(new Set(evidenceKeys)).slice(0, 24),
    minimumUsefulRecommendations,
    currentPeriod: {
      netSales: currentAmountComplete ? current.totalNetSales : null,
      units: currentComplete ? current.totalUnits : null,
      complete: currentComplete
    },
    previousPeriod: {
      netSales: previousAmountComplete ? previous?.totalNetSales ?? 0 : null,
      units: previousComplete ? previous?.totalUnits ?? 0 : null,
      complete: previousComplete
    },
    comparisonAvailable,
    narrativeEligible,
    limitations: Array.from(new Set(limitations))
  };
};

export default buildAssortmentAnalysis;
