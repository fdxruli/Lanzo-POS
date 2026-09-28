const MAX_COMPETITORS = 5;
const MAX_OBSERVATIONS = 20;
const MAX_TEXT_LENGTH = Object.freeze({
  competitorName: 100,
  description: 600,
  location: 160,
  sourceLabel: 160,
  sourceText: 3000,
  productName: 120,
  category: 100,
  unit: 80,
  promotion: 300,
  observation: 600
});

const SOURCE_TYPES = new Set(['manual', 'public_url', 'copied_text', 'user_observation']);
const OBSERVATION_TYPES = new Set(['product', 'service']);
const PRICE_TYPES = new Set(['regular', 'promotion', 'unknown']);
const TAX_STATUSES = new Set(['included', 'excluded', 'unknown']);
const SHIPPING_STATUSES = new Set(['included', 'excluded', 'not_applicable', 'unknown']);
const CURRENCY_PATTERN = /^[A-Z]{3}$/u;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const SENSITIVE_QUERY_KEY = /(?:token|secret|password|passwd|auth|credential|session|signature|api[-_]?key|access[-_]?key)/iu;

const asRecord = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const asArray = (value) => Array.isArray(value) ? value : [];
const cleanText = (value, maxLength = 200) => (typeof value === 'string' ? value : '')
  .replace(/<[^>]*>/gu, ' ')
  .replace(/\p{Cc}/gu, ' ')
  .replace(/\s+/gu, ' ')
  .trim()
  .slice(0, maxLength);

export const normalizeCompetitiveText = (value) => cleanText(value, 1000)
  .toLocaleLowerCase('es-MX')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/gu, '')
  .replace(/\s+/gu, ' ')
  .trim();

const isPublicIpV4 = (host) => {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/u.test(host)) return true;
  const parts = host.split('.').map(Number);
  if (parts.some((part) => part > 255)) return false;
  const [a, b] = parts;
  return !(a === 0 || a === 10 || a === 127 || a >= 224
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 100 && b >= 64 && b <= 127));
};

const isPublicHostname = (hostname) => {
  const host = hostname.toLowerCase().replace(/^\[|\]$/gu, '').replace(/\.$/u, '');
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')
    || host.endsWith('.internal') || host.endsWith('.test') || host.endsWith('.lan')) return false;
  if (host.includes(':')) return false; // Reject IPv6 literals, including loopback and link-local ranges.
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/u.test(host)) return isPublicIpV4(host);
  return host.includes('.') && !host.split('.').some((label) => !label || label.startsWith('-') || label.endsWith('-'));
};

export const sanitizePublicHttpUrl = (value) => {
  const candidate = cleanText(value, 2048);
  if (!candidate) return { valid: true, url: null };
  try {
    const parsed = new URL(candidate);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password
      || !isPublicHostname(parsed.hostname)) return { valid: false, url: null };
    for (const key of parsed.searchParams.keys()) {
      if (SENSITIVE_QUERY_KEY.test(key)) return { valid: false, url: null };
    }
    parsed.hash = '';
    return { valid: true, url: parsed.toString().slice(0, 2048) };
  } catch {
    return { valid: false, url: null };
  }
};

const validDateOnly = (value, now) => {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) return false;
  const today = new Date(now).toISOString().slice(0, 10);
  return value <= today;
};

const normalizeSource = (value, errors, path) => {
  const source = asRecord(value);
  const type = SOURCE_TYPES.has(source.type) ? source.type : null;
  if (!type) errors.push(`${path}.type`);
  const safeUrl = sanitizePublicHttpUrl(source.url);
  if (!safeUrl.valid) errors.push(`${path}.url`);
  const label = cleanText(source.label, MAX_TEXT_LENGTH.sourceLabel);
  const text = cleanText(source.text, MAX_TEXT_LENGTH.sourceText);
  if (type === 'copied_text' && !text) errors.push(`${path}.text`);
  if (type === 'public_url' && !safeUrl.url) errors.push(`${path}.url`);
  return {
    type: type || 'manual',
    label: label || null,
    url: safeUrl.url,
    text: text || null,
    evidenceType: 'user_provided',
    verified: false
  };
};

const parseOptionalPrice = (value, errors, path) => {
  if (value === '' || value === null || value === undefined) return null;
  const price = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isFinite(price) || price < 0 || price > 1_000_000_000) {
    errors.push(path);
    return null;
  }
  return Math.round(price * 100) / 100;
};

const observationDuplicateKey = (row) => [
  row.type,
  normalizeCompetitiveText(row.name),
  normalizeCompetitiveText(row.unit),
  row.currency,
  row.price,
  row.priceType,
  normalizeCompetitiveText(row.promotion)
].join('\u0000');

/** Validate and allowlist user supplied evidence. No remote content is retrieved here. */
export const validateCompetitiveEvidence = (input, { now = new Date() } = {}) => {
  const root = asRecord(input);
  const errors = [];
  const warnings = [];
  const rows = asArray(root.competitors);
  if (rows.length > MAX_COMPETITORS) errors.push('competitors.limit');
  if (!rows.length) errors.push('competitors.required');

  const competitors = [];
  const competitorKeys = new Set();
  let observationOrdinal = 0;
  rows.slice(0, MAX_COMPETITORS).forEach((rawCompetitor, competitorIndex) => {
    const source = asRecord(rawCompetitor);
    const path = `competitors.${competitorIndex}`;
    const name = cleanText(source.name, MAX_TEXT_LENGTH.competitorName);
    if (!name) errors.push(`${path}.name`);
    const location = cleanText(source.location, MAX_TEXT_LENGTH.location);
    const duplicateKey = `${normalizeCompetitiveText(name)}\u0000${normalizeCompetitiveText(location)}`;
    if (name && competitorKeys.has(duplicateKey)) errors.push(`${path}.duplicate`);
    competitorKeys.add(duplicateKey);
    if (!validDateOnly(source.observedAt, now)) errors.push(`${path}.observedAt`);
    const provenance = normalizeSource(source.source, errors, `${path}.source`);
    const observations = [];
    const observationKeys = new Set();
    const rawObservations = asArray(source.observations);
    if (rawObservations.length > MAX_OBSERVATIONS) errors.push(`${path}.observations.limit`);
    if (!rawObservations.length) errors.push(`${path}.observations.required`);
    rawObservations.slice(0, MAX_OBSERVATIONS).forEach((rawObservation, observationIndex) => {
      const item = asRecord(rawObservation);
      const itemPath = `${path}.observations.${observationIndex}`;
      const type = OBSERVATION_TYPES.has(item.type) ? item.type : 'product';
      const itemName = cleanText(item.name, MAX_TEXT_LENGTH.productName);
      if (!itemName) errors.push(`${itemPath}.name`);
      const price = parseOptionalPrice(item.price, errors, `${itemPath}.price`);
      const rawCurrency = typeof item.currency === 'string' ? item.currency.trim().toUpperCase() : '';
      const currency = CURRENCY_PATTERN.test(rawCurrency) ? rawCurrency : null;
      if (price !== null && !currency) errors.push(`${itemPath}.currency`);
      const priceType = PRICE_TYPES.has(item.priceType) ? item.priceType : 'unknown';
      const taxStatus = TAX_STATUSES.has(item.taxStatus) ? item.taxStatus : 'unknown';
      const shippingStatus = SHIPPING_STATUSES.has(item.shippingStatus) ? item.shippingStatus : 'unknown';
      const observation = {
        type,
        name: itemName,
        description: cleanText(item.description, MAX_TEXT_LENGTH.description) || null,
        category: cleanText(item.category, MAX_TEXT_LENGTH.category) || null,
        price,
        currency,
        unit: cleanText(item.unit, MAX_TEXT_LENGTH.unit) || null,
        priceType,
        promotion: cleanText(item.promotion, MAX_TEXT_LENGTH.promotion) || null,
        taxStatus,
        shippingStatus,
        note: cleanText(item.note, MAX_TEXT_LENGTH.observation) || null,
        comparableConfirmed: item.comparableConfirmed === true
      };
      const duplicateKey = observationDuplicateKey(observation);
      if (itemName && observationKeys.has(duplicateKey)) {
        warnings.push(`${itemPath}.duplicate_removed`);
        return;
      }
      if (itemName) observationKeys.add(duplicateKey);
      observations.push({ ...observation, evidenceKey: `external.observation:${observationOrdinal++}` });
    });
    competitors.push({
      name,
      description: cleanText(source.description, MAX_TEXT_LENGTH.description) || null,
      location: location || null,
      observedAt: typeof source.observedAt === 'string' ? source.observedAt : null,
      source: provenance,
      evidenceType: 'user_provided',
      verified: false,
      observations
    });
  });

  if (competitors.length > 0 && competitors.every((competitor) => competitor.observations.length === 0)) {
    errors.push('observations.required');
  }
  return {
    valid: errors.length === 0,
    errors: Array.from(new Set(errors)),
    warnings: Array.from(new Set(warnings)),
    evidence: {
      evidenceType: 'user_provided',
      verified: false,
      capturedAt: typeof root.capturedAt === 'string' && !Number.isNaN(Date.parse(root.capturedAt))
        ? new Date(root.capturedAt).toISOString()
        : null,
      competitors
    }
  };
};

const activeProduct = (product) => {
  const row = asRecord(product);
  return row.isActive !== false && row.is_active !== false && row.active !== false && row.status !== 'inactive' && row.deleted !== true
    && !row.deletedAt && !row.deletedTimestamp && !row.deleted_at && !row.deleted_timestamp;
};

const internalPriceOf = (product) => {
  const row = asRecord(product);
  for (const key of ['price', 'salePrice', 'sellingPrice']) {
    const value = row[key];
    if (value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)) && Number(value) >= 0) {
      return Math.round(Number(value) * 100) / 100;
    }
  }
  return null;
};

const internalUnitOf = (product) => {
  const row = asRecord(product);
  return cleanText(row.presentation ?? row.unit ?? row.unitLabel ?? row.unitName, MAX_TEXT_LENGTH.unit) || null;
};

const parseMeasure = (value) => {
  const text = normalizeCompetitiveText(value).replace(/,/gu, '.');
  const match = text.match(/^\s*(\d+(?:\.\d+)?)\s*(ml|millilitros?|l|lt|litros?|mg|miligramos?|g|gr|gramos?|kg|kilogramos?|pzas?|piezas?|unidades?|u|ud)\s*$/u);
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const unit = match[2];
  if (['ml', 'mililitro', 'mililitros', 'l', 'lt', 'litro', 'litros'].includes(unit)) {
    return { family: 'volume', baseAmount: amount * (['l', 'lt', 'litro', 'litros'].includes(unit) ? 1000 : 1), basis: 'ml' };
  }
  if (['mg', 'miligramo', 'miligramos', 'g', 'gr', 'gramo', 'gramos', 'kg', 'kilogramo', 'kilogramos'].includes(unit)) {
    const factor = ['mg', 'miligramo', 'miligramos'].includes(unit) ? 0.001
      : ['kg', 'kilogramo', 'kilogramos'].includes(unit) ? 1000 : 1;
    return { family: 'mass', baseAmount: amount * factor, basis: 'g' };
  }
  return { family: 'count', baseAmount: amount, basis: 'pza' };
};

const comparePresentation = (ownUnit, externalUnit) => {
  if (!ownUnit || !externalUnit) return { comparable: false, reason: 'presentation_unknown' };
  if (normalizeCompetitiveText(ownUnit) === normalizeCompetitiveText(externalUnit)) {
    return { comparable: true, basis: null, ownFactor: 1, externalFactor: 1, normalized: false };
  }
  const own = parseMeasure(ownUnit);
  const external = parseMeasure(externalUnit);
  if (!own || !external || own.family !== external.family) return { comparable: false, reason: 'presentation_mismatch' };
  return {
    comparable: true,
    basis: own.basis,
    ownFactor: 1 / own.baseAmount,
    externalFactor: 1 / external.baseAmount,
    normalized: true
  };
};

const toInternalCatalog = (catalog, currency) => {
  const source = asRecord(catalog);
  const complete = source.complete === true && source.productsTruncated !== true && source.categoriesTruncated !== true;
  const categories = new Map(asArray(source.categories)
    .filter((row) => asRecord(row).id && asRecord(row).isActive !== false && asRecord(row).active !== false && cleanText(asRecord(row).name, 120))
    .map((row) => [String(asRecord(row).id), cleanText(asRecord(row).name, 120)]));
  const products = asArray(source.products).filter(activeProduct).flatMap((rawProduct) => {
    const row = asRecord(rawProduct);
    const name = cleanText(row.name, MAX_TEXT_LENGTH.productName);
    if (!name) return [];
    const categoryId = row.categoryId ?? row.category_id;
    return [{
      name,
      category: cleanText(row.categoryName ?? categories.get(String(categoryId)) ?? row.category, MAX_TEXT_LENGTH.category) || null,
      price: internalPriceOf(row),
      currency,
      unit: internalUnitOf(row),
      priceType: 'regular'
    }];
  });
  return { products, complete, categories: Array.from(new Set(products.map((product) => product.category).filter(Boolean))) };
};

const makePriceComparison = (competitor, observation, internalCatalog, ownCurrency, evidenceIndex) => {
  const base = {
    competitorName: competitor.name,
    observedAt: competitor.observedAt,
    source: competitor.source,
    productName: observation.name,
    externalPrice: observation.price,
    externalCurrency: observation.currency,
    externalUnit: observation.unit,
    externalPriceType: observation.priceType,
    taxStatus: observation.taxStatus,
    ownTaxStatus: 'unknown',
    shippingStatus: observation.shippingStatus,
    evidenceKeys: [`external.observation:${evidenceIndex}`]
  };
  const fail = (reason, own = null) => ({
    ...base,
    comparisonStatus: 'not_comparable',
    reason,
    ownProductName: own?.name || null,
    ownPrice: own?.price ?? null,
    ownCurrency: own?.currency || null,
    ownUnit: own?.unit || null,
    difference: null,
    differencePercent: null,
    basis: null
  });
  if (observation.type !== 'product') return fail('service');
  if (!observation.comparableConfirmed) return fail('confirmation_required');
  const nameMatches = internalCatalog.products.filter((product) => normalizeCompetitiveText(product.name) === normalizeCompetitiveText(observation.name));
  if (!nameMatches.length) return fail(internalCatalog.complete ? 'internal_product_not_found' : 'internal_catalog_incomplete');
  if (nameMatches.length > 1) return fail('ambiguous_internal_product');
  const own = nameMatches[0];
  if (observation.price === null) return fail('price_unknown', own);
  if (!observation.currency || !ownCurrency || observation.currency !== ownCurrency) return fail('currency_mismatch_or_unknown', own);
  if (observation.priceType !== 'regular') return fail(observation.priceType === 'promotion' ? 'temporary_promotion' : 'price_type_unknown', own);
  if (observation.shippingStatus === 'included') return fail('shipping_included', own);
  if (own.price === null) return fail('own_price_unknown', own);
  const presentation = comparePresentation(own.unit, observation.unit);
  if (!presentation.comparable) return fail(presentation.reason, own);
  const ownPrice = own.price * presentation.ownFactor;
  const externalPrice = observation.price * presentation.externalFactor;
  const difference = Math.round((externalPrice - ownPrice) * 100) / 100;
  const differencePercent = ownPrice > 0 ? Math.round((difference / ownPrice) * 10000) / 100 : null;
  const conditionNotes = [];
  conditionNotes.push('impuestos del catálogo propio desconocidos');
  if (observation.taxStatus === 'unknown') conditionNotes.push('impuestos del competidor desconocidos');
  if (observation.shippingStatus === 'unknown') conditionNotes.push('envío del competidor desconocido');
  if (observation.taxStatus === 'excluded') conditionNotes.push('el precio observado excluye impuestos');
  return {
    ...base,
    comparisonStatus: conditionNotes.length ? 'comparable_with_conditions' : 'comparable',
    reason: null,
    ownProductName: own.name,
    ownPrice: own.price,
    ownCurrency: own.currency,
    ownUnit: own.unit,
    normalizedOwnPrice: Math.round(ownPrice * 10000) / 10000,
    normalizedExternalPrice: Math.round(externalPrice * 10000) / 10000,
    difference,
    differencePercent,
    basis: presentation.basis,
    normalizedPresentation: presentation.normalized,
    conditionNotes,
    evidenceKeys: [...base.evidenceKeys, `internal.product:${evidenceIndex}`, `comparison.price:${evidenceIndex}`]
  };
};

const displayObservedOffers = (evidence, internalCatalog) => {
  const observed = evidence.competitors.flatMap((competitor) => competitor.observations.map((item) => {
    return item.type === 'product'
      ? { competitorName: competitor.name, observedAt: competitor.observedAt, source: competitor.source, ...item }
      : null;
  }).filter(Boolean));
  const ownNames = new Set(internalCatalog.products.map((product) => normalizeCompetitiveText(product.name)));
  const unmatched = internalCatalog.complete
    ? observed.filter((item) => !ownNames.has(normalizeCompetitiveText(item.name)))
    : [];
  const ownUnobserved = internalCatalog.complete
    ? internalCatalog.products.filter((product) => !observed.some((item) => normalizeCompetitiveText(item.name) === normalizeCompetitiveText(product.name)))
    : [];
  return {
    observedFromCompetitor: observed.slice(0, 100),
    observedObservationCount: observed.length,
    observedButNotMatchedToOwnCatalog: unmatched.slice(0, 100),
    observedButNotMatchedCount: unmatched.length,
    ownProductsNotFoundInCapturedEvidence: ownUnobserved.slice(0, 100),
    ownProductsNotFoundInCapturedEvidenceCount: ownUnobserved.length,
    ownProductsNotFoundInCapturedEvidenceTruncated: ownUnobserved.length > 100,
    catalogComplete: internalCatalog.complete,
    observedCategories: Array.from(new Set(evidence.competitors.flatMap((competitor) => competitor.observations.map((item) => item.category).filter(Boolean)))),
    businessCategories: internalCatalog.categories,
    sharedCategories: Array.from(new Set(evidence.competitors.flatMap((competitor) => competitor.observations.map((item) => item.category).filter(Boolean))))
      .filter((category) => internalCatalog.categories.some((ownCategory) => normalizeCompetitiveText(ownCategory) === normalizeCompetitiveText(category))),
    observedCategoriesNotInBusinessCatalog: internalCatalog.complete
      ? Array.from(new Set(evidence.competitors.flatMap((competitor) => competitor.observations.map((item) => item.category).filter(Boolean))))
        .filter((category) => !internalCatalog.categories.some((ownCategory) => normalizeCompetitiveText(ownCategory) === normalizeCompetitiveText(category)))
      : [],
    categoryComparisonAvailable: internalCatalog.complete
  };
};

/** Compare user-provided observations with one canonical active tenant catalog snapshot. */
export const buildCompetitiveAnalysis = ({ evidence, catalog, ownCurrency = 'MXN', now = new Date() } = {}) => {
  const validated = validateCompetitiveEvidence(evidence, { now });
  if (!validated.valid) return { status: 'insufficient_data', errors: validated.errors, limitations: ['La evidencia externa no superó la validación.'] };
  const currency = CURRENCY_PATTERN.test(String(ownCurrency || '').toUpperCase()) ? String(ownCurrency).toUpperCase() : null;
  const internalCatalog = toInternalCatalog(catalog, currency);
  const competitors = validated.evidence.competitors;
  let observationOrdinal = 0;
  const priceComparisons = competitors.flatMap((competitor) => competitor.observations.map((observation) => {
    const index = observationOrdinal++;
    return makePriceComparison(competitor, observation, internalCatalog, currency, index);
  }));
  const comparablePrices = priceComparisons.filter((item) => ['comparable', 'comparable_with_conditions'].includes(item.comparisonStatus));
  const offerComparison = displayObservedOffers(validated.evidence, internalCatalog);
  const limitations = [
    'La evidencia de competencia fue proporcionada por el usuario y no se verificó automáticamente.',
    'Una URL se conserva como referencia; Lanzo no consultó su contenido.',
    ...(!internalCatalog.complete ? ['El catálogo propio está incompleto; las ausencias no se interpretan como diferencias de oferta.'] : []),
    ...(priceComparisons.some((item) => item.comparisonStatus === 'not_comparable') ? ['Los registros no comparables se muestran sin inferir equivalencias.'] : []),
    ...(comparablePrices.some((item) => item.conditionNotes?.length) ? ['Algunas condiciones comerciales, como impuestos o envío, son desconocidas o difieren.'] : []),
    'La presencia de un producto observado no demuestra demanda, ventas ni rentabilidad.'
  ];
  const recommendations = [];
  const appendRecommendation = (key, title, explanation, evidenceKeys) => {
    if (recommendations.length >= 3 || recommendations.some((item) => item.key === key) || !evidenceKeys.length) return;
    recommendations.push({
      key,
      type: 'investigation',
      title,
      explanation,
      expectedImpact: 'No estimado: la observación no demuestra demanda ni rentabilidad.',
      priority: 'medium',
      evidenceKeys,
      requiresConfirmation: true
    });
  };
  const higherObserved = comparablePrices.find((item) => item.difference > 0);
  const lowerObserved = comparablePrices.find((item) => item.difference < 0);
  if (higherObserved) appendRecommendation('price_review', 'Revisar la diferencia de precio observada', 'Valida que presentación, vigencia e impuestos sean equivalentes antes de decidir si conviene hacer un cambio.', higherObserved.evidenceKeys);
  if (lowerObserved) appendRecommendation('price_position', 'Revisar el precio propio frente a la observación', 'La observación registrada tiene un precio menor en una presentación comparable; evalúa costos y condiciones antes de tomar una decisión.', lowerObserved.evidenceKeys);
  if (offerComparison.observedButNotMatchedToOwnCatalog.length) {
    const item = offerComparison.observedButNotMatchedToOwnCatalog[0];
    appendRecommendation('offer_investigation', 'Investigar una diferencia de oferta', 'El artículo aparece en la evidencia capturada y no coincide por nombre exacto con el catálogo propio. Esto no demuestra demanda; valida si es relevante para tus clientes.', [item.evidenceKey]);
  }
  const unmatchedObservedCategory = offerComparison.observedCategoriesNotInBusinessCatalog?.[0];
  if (unmatchedObservedCategory) {
    const item = offerComparison.observedFromCompetitor.find((row) => normalizeCompetitiveText(row.category) === normalizeCompetitiveText(unmatchedObservedCategory));
    if (item?.evidenceKey) appendRecommendation('category_investigation', 'Investigar una categoría observada', 'La categoría aparece en la evidencia capturada y no tiene una coincidencia exacta por nombre en tu catálogo. Esto no demuestra demanda.', [item.evidenceKey]);
  }
  const capturedAt = validated.evidence.capturedAt || (now instanceof Date ? now : new Date(now)).toISOString();
  const staleThreshold = 90 * 24 * 60 * 60 * 1000;
  const staleCompetitors = competitors.filter((competitor) => Date.parse(`${competitor.observedAt}T00:00:00Z`) < new Date(capturedAt).getTime() - staleThreshold).map((competitor) => competitor.name);
  const priceComparisonsCount = comparablePrices.length;
  const primaryPriceComparison = comparablePrices[0];
  const priceInsight = primaryPriceComparison
    ? (() => {
      const absoluteDifference = Math.abs(primaryPriceComparison.difference).toFixed(2);
      const direction = primaryPriceComparison.difference > 0 ? 'superior al precio registrado en tu catálogo'
        : primaryPriceComparison.difference < 0 ? 'inferior al precio registrado en tu catálogo'
          : 'igual al precio registrado en tu catálogo';
      const unitBasis = primaryPriceComparison.basis ? ` por ${primaryPriceComparison.basis}` : '';
      const percent = primaryPriceComparison.differencePercent === null
        ? ''
        : ` (${Math.abs(primaryPriceComparison.differencePercent).toFixed(2)}% de diferencia)`;
      const conditions = primaryPriceComparison.conditionNotes?.length
        ? ` La lectura es condicional: ${primaryPriceComparison.conditionNotes.join('; ')}.`
        : '';
      return `Para ${primaryPriceComparison.productName}, ${primaryPriceComparison.competitorName} registró una diferencia de ${absoluteDifference} ${primaryPriceComparison.ownCurrency}${unitBasis}, ${direction}${percent}.${conditions}`;
    })()
    : null;
  const executiveSummary = priceComparisonsCount
    ? `Se calcularon ${priceComparisonsCount} comparación(es) de precio con producto y presentación confirmados. ${priceInsight} La evidencia externa fue aportada por ti; revisa la fecha y las condiciones antes de tomar una decisión.`
    : `${competitors.length} competidor(es) y ${competitors.reduce((sum, competitor) => sum + competitor.observations.length, 0)} observación(es) quedaron registrados. No hay precios con equivalencia suficiente para una comparación numérica.`;
  const explanation = offerComparison.observedButNotMatchedToOwnCatalog.length
    ? `Se observó ${offerComparison.observedButNotMatchedToOwnCatalog.length} producto(s) que no coinciden por nombre exacto con tu catálogo. Puedes investigar si representan una diferencia relevante; la observación no prueba demanda.`
    : 'Las diferencias de oferta se basan en los productos y servicios incluidos en la evidencia capturada. Lo que no aparece en esa evidencia permanece desconocido.';
  return {
    status: 'completed',
    evidenceType: 'user_provided',
    verified: false,
    capturedAt,
    competitors,
    internalBusiness: {
      source: 'local_tenant_catalog',
      catalogComplete: internalCatalog.complete,
      currency,
      activeProductCount: internalCatalog.products.length,
      activeCategoryCount: internalCatalog.categories.length,
      categories: internalCatalog.categories
    },
    priceComparisons,
    offerComparison,
    recommendations,
    limitations: Array.from(new Set(limitations)),
    staleCompetitors,
    executiveSummary,
    answer: executiveSummary,
    explanation,
    confidence: internalCatalog.complete && (comparablePrices.length > 0 || competitors.length > 0) ? 'medium' : 'low',
    evidenceWarnings: validated.warnings
  };
};

export const COMPETITIVE_ANALYSIS_LIMITS = Object.freeze({
  competitors: MAX_COMPETITORS,
  observationsPerCompetitor: MAX_OBSERVATIONS,
  text: MAX_TEXT_LENGTH
});
