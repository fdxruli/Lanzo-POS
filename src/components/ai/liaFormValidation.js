import {
  normalizeScenarioForIntent,
  validateCommercialAgentScenario
} from '../../services/ai/commercialAgentContract';
import { sanitizePublicHttpUrl } from '../../services/ai/competitiveAnalysis';

const fieldHasValue = (value) => value !== undefined && value !== null
  && !(typeof value === 'string' && value.trim() === '');

const competitiveFieldId = (competitor, competitorIndex, field, observation, observationIndex) => {
  const competitorKey = competitor?.uiKey || `competitor-${competitorIndex + 1}`;
  const observationKey = observation?.uiKey || `observation-${observationIndex + 1}`;
  if (observationIndex !== undefined) return `lia-${competitorKey}-${observationKey}-${field}`;
  const controlField = {
    observedAt: 'observed',
    'source.type': 'source',
    'source.url': 'url',
    'source.text': 'source-text'
  }[field] || field;
  return `lia-${competitorKey}-${controlField}`;
};

const scenarioFieldsByIntent = Object.freeze({
  goal_simulation: ['goalType', 'targetValue', 'productName'],
  what_if_analysis: ['changeType', 'changePercent', 'productName'],
  price_simulation: ['productName', 'newPrice', 'historicalVolume'],
  promotion_opportunity: ['productName', 'discountPercent', 'promotionalPrice', 'historicalVolume']
});

const SCENARIO_TARGET_IDS = Object.freeze({
  goalType: 'sales-agent-goal-type',
  targetValue: 'sales-agent-goal-target',
  changeType: 'sales-agent-what-if-type',
  changePercent: 'sales-agent-what-if-percent',
  productName: 'sales-agent-product',
  newPrice: 'sales-agent-new-price',
  discountPercent: 'sales-agent-discount',
  promotionalPrice: 'sales-agent-promotional-price',
  historicalVolume: 'sales-agent-historical-volume',
  promotionMode: 'sales-agent-promotion-mode'
});

const scenarioFieldLabel = (intent, field, scenario = {}) => ({
  goalType: 'Tipo de meta',
  targetValue: ['gross_margin', 'product_margin'].includes(scenario.goalType) ? 'Margen objetivo' : 'Valor objetivo',
  changeType: 'Variable a modificar',
  changePercent: 'Cambio porcentual',
  productName: intent === 'what_if_analysis'
    ? 'Producto con ventas históricas'
    : intent === 'goal_simulation' ? 'Producto con costo conocido' : 'Producto',
  newPrice: 'Nuevo precio',
  discountPercent: 'Descuento porcentual',
  promotionalPrice: 'Precio promocional',
  historicalVolume: 'Volumen esperado',
  promotionMode: 'Tipo de promoción'
}[field] || (intent ? 'Parámetro' : 'Campo'));

const scenarioErrorMessage = (code, field, intent, scenario = {}) => {
  if (code === 'GOAL_TARGET_REQUIRED') return 'Introduce un valor objetivo mayor que cero.';
  if (code === 'INVALID_GOAL_TYPE') return 'Selecciona qué meta quieres alcanzar.';
  if (code === 'INVALID_CHANGE_TYPE') return 'Selecciona qué variable deseas modificar.';
  if (code === 'CHANGE_PERCENT_REQUIRED') return 'Introduce el porcentaje de cambio.';
  if (code === 'PRODUCT_REQUIRED') return 'Selecciona el producto que deseas simular.';
  if (code === 'NEW_PRICE_REQUIRED') return 'Introduce el nuevo precio.';
  if (code === 'PROMOTION_SCENARIO_AMBIGUOUS') return 'Elige un descuento porcentual o un precio promocional, no ambos.';
  if (code === 'INVALID_SCENARIO_PRODUCT') return 'Selecciona un producto disponible para este periodo.';
  if (code === 'INVALID_SCENARIO_NUMBER') return 'Introduce un valor numérico válido.';
  if (code === 'SCENARIO_VALUE_MUST_BE_POSITIVE') {
    return field === 'targetValue'
      ? 'Introduce un valor objetivo mayor que cero.'
      : 'Introduce un valor mayor que cero.';
  }
  if (code === 'SCENARIO_VALUE_OUT_OF_RANGE') {
    if (field === 'targetValue' && ['gross_margin', 'product_margin'].includes(scenario.goalType)) {
      return 'El margen objetivo debe ser inferior al 100%.';
    }
    if (field === 'changePercent' || intent === 'what_if_analysis') {
      return 'El porcentaje permitido va de −99.9% a +500%.';
    }
    if (field === 'discountPercent') return 'El descuento debe estar entre 0% y 100%.';
    if (field === 'historicalVolume') return 'El volumen esperado no puede ser negativo.';
    return 'Revisa el valor y utiliza un importe dentro del rango permitido.';
  }
  if (code === 'INVALID_CHANGE_TYPE') return 'Selecciona qué variable deseas modificar.';
  return 'Revisa este dato antes de continuar.';
};

const scenarioPathForCode = (code, fallbackField) => {
  if (fallbackField) return fallbackField;
  if (code === 'INVALID_GOAL_TYPE') return 'goalType';
  if (code === 'INVALID_CHANGE_TYPE') return 'changeType';
  if (code === 'GOAL_TARGET_REQUIRED') return 'targetValue';
  if (code === 'CHANGE_PERCENT_REQUIRED') return 'changePercent';
  if (code === 'PRODUCT_REQUIRED' || code === 'INVALID_SCENARIO_PRODUCT') return 'productName';
  if (code === 'NEW_PRICE_REQUIRED') return 'newPrice';
  if (code === 'PROMOTION_SCENARIO_AMBIGUOUS') return 'promotionMode';
  return 'targetValue';
};

const scenarioIssue = (intent, scenario, code, path) => ({
  id: `lia-scenario-${path}-${code}`,
  path,
  targetId: path === 'productName' && intent === 'goal_simulation'
    ? 'sales-agent-goal-product'
    : path === 'productName' && intent === 'what_if_analysis'
      ? 'sales-agent-what-if-product'
      : SCENARIO_TARGET_IDS[path] || SCENARIO_TARGET_IDS.productName,
  fieldLabel: scenarioFieldLabel(intent, path, scenario),
  message: scenarioErrorMessage(code, path, intent, scenario),
  severity: 'error'
});

/**
 * Run the existing normalizer per captured field so the form can explain more
 * than the first malformed value, then use the contract validator for required
 * and cross-field rules.
 */
export const validateLiaScenarioForm = (intent, scenario = {}) => {
  const fields = scenarioFieldsByIntent[intent] || [];
  if (!fields.length) return { valid: true, normalized: {}, issues: [] };

  const modeField = intent === 'goal_simulation' ? 'goalType'
    : intent === 'what_if_analysis' ? 'changeType' : null;
  const normalized = {};
  const issues = [];
  const issuePaths = new Set();

  fields.forEach((field) => {
    if (!fieldHasValue(scenario[field])) return;
    const partialScenario = {
      ...(modeField && field !== modeField && fieldHasValue(scenario[modeField])
        ? { [modeField]: scenario[modeField] }
        : {}),
      [field]: scenario[field]
    };
    try {
      Object.assign(normalized, normalizeScenarioForIntent(intent, partialScenario));
    } catch (error) {
      const code = error?.code || error?.message || 'INVALID_SCENARIO';
      const path = scenarioPathForCode(code, field);
      issuePaths.add(path);
      issues.push(scenarioIssue(intent, scenario, code, path));
    }
  });

  const contractValidation = validateCommercialAgentScenario(intent, normalized);
  if (!contractValidation.valid) {
    const contractIssues = Array.isArray(contractValidation.errors) && contractValidation.errors.length
      ? contractValidation.errors
      : [{ code: contractValidation.code, path: scenarioPathForCode(contractValidation.code) }];
    contractIssues.forEach(({ code, path: reportedPath }) => {
      const path = scenarioPathForCode(code, reportedPath);
      if (issuePaths.has(path)) return;
      issuePaths.add(path);
      issues.push(scenarioIssue(intent, scenario, code, path));
    });
  }

  return {
    valid: issues.length === 0,
    normalized,
    issues
  };
};

const dateIssueMessage = (value) => {
  if (!value) return 'Selecciona la fecha en que observaste esta información.';
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    return 'Selecciona una fecha válida para esta observación.';
  }
  if (value > new Date().toISOString().slice(0, 10)) return 'La fecha de observación no puede ser futura.';
  return 'Selecciona una fecha válida para esta observación.';
};

const parseCompetitivePath = (path) => {
  const match = String(path).match(/^competitors\.(\d+)(?:\.observations\.(\d+))?(?:\.(.+))?$/u);
  if (!match) return null;
  return {
    competitorIndex: Number(match[1]),
    observationIndex: match[2] === undefined ? undefined : Number(match[2]),
    field: match[3] || ''
  };
};

const competitiveFieldMessage = (path, competitor, observation) => {
  const value = competitor || {};
  const item = observation || {};
  if (path === 'competitors.required') return 'Añade al menos un competidor para comparar.';
  if (path === 'competitors.limit') return 'Alcanzaste el límite permitido de competidores.';
  if (path === 'observations.required') return 'Añade al menos una observación antes de analizar.';
  if (path.endsWith('.observations.required')) return 'Añade al menos una observación para este competidor.';
  if (path.endsWith('.observations.limit')) return 'Alcanzaste el límite permitido de observaciones.';
  if (path.endsWith('.duplicate')) return 'Ya registraste un competidor con ese nombre y ubicación.';
  if (path.endsWith('.duplicate_removed')) return 'Esta observación está repetida; revisa si necesitas conservar ambas.';
  if (path.endsWith('.name') && path.includes('.observations.')) return 'Escribe el nombre del producto o servicio.';
  if (path.endsWith('.name')) return 'Escribe el nombre comercial del competidor.';
  if (path.endsWith('.observedAt')) return dateIssueMessage(value.observedAt);
  if (path.endsWith('.source.type')) return 'Selecciona de dónde obtuviste esta información.';
  if (path.endsWith('.source.url')) {
    if (!String(value.source?.url || '').trim()) return 'Introduce la URL pública de referencia.';
    return sanitizePublicHttpUrl(value.source?.url).valid
      ? 'Introduce la URL pública de referencia.'
      : 'Utiliza una dirección pública HTTP o HTTPS válida.';
  }
  if (path.endsWith('.source.text')) return 'Pega el texto de la fuente que quieres registrar.';
  if (path.endsWith('.price')) return 'Introduce un importe numérico válido.';
  if (path.endsWith('.currency')) {
    return String(item.currency || '').trim()
      ? 'Utiliza un código de moneda de tres letras.'
      : 'Indica la moneda del precio, por ejemplo MXN.';
  }
  return 'Revisa este dato antes de continuar.';
};

const competitiveFieldLabel = (competitorIndex, observationIndex, field) => {
  const labels = {
    name: observationIndex === undefined ? 'Nombre comercial' : 'Nombre',
    observedAt: 'Fecha observada',
    'source.type': 'Procedencia',
    'source.url': 'URL pública',
    'source.text': 'Texto copiado',
    price: 'Precio',
    currency: 'Moneda',
    duplicate: 'Nombre comercial'
  };
  if (field === 'required') return 'Observaciones';
  const context = [`Competidor ${competitorIndex + 1}`];
  if (observationIndex !== undefined) context.push(`Observación ${observationIndex + 1}`);
  return `${context.join(' → ')} → ${labels[field] || field}`;
};

export const presentCompetitiveValidation = (validation, value = {}) => {
  const competitors = Array.isArray(value?.competitors) ? value.competitors : [];
  const mapPath = (path, severity = 'error') => {
    if (path === 'competitors.required' || path === 'competitors.limit') {
      return {
        id: `lia-${path}`,
        path,
        targetId: 'lia-competitive-add-competitor',
        fieldLabel: 'Competidores',
        message: competitiveFieldMessage(path),
        severity
      };
    }
    if (path === 'observations.required') {
      const competitor = competitors[0];
      return {
        id: `lia-${path}`,
        path,
        targetId: competitor ? `lia-${competitor.uiKey || 'competitor-1'}-add-observation` : 'lia-competitive-add-competitor',
        fieldLabel: 'Observaciones',
        message: competitiveFieldMessage(path),
        severity
      };
    }
    const parsed = parseCompetitivePath(path);
    if (!parsed) return null;
    const { competitorIndex, observationIndex, field } = parsed;
    const competitor = competitors[competitorIndex];
    const observation = observationIndex === undefined ? null : competitor?.observations?.[observationIndex];
    const isObservationCollection = field === 'observations.required' || field === 'observations.limit';
    const controlField = field === 'duplicate' || field === 'duplicate_removed'
      ? 'name'
      : observationIndex !== undefined ? field.split('.').at(-1) : field;
    const targetId = isObservationCollection
      ? `lia-${competitor?.uiKey || `competitor-${competitorIndex + 1}`}-add-observation`
      : observationIndex !== undefined
        ? competitiveFieldId(competitor, competitorIndex, controlField, observation, observationIndex)
        : competitiveFieldId(competitor, competitorIndex, controlField);
    const normalizedField = isObservationCollection ? field.split('.').at(-1) : controlField;
    return {
      id: `lia-${path}`,
      path,
      targetId,
      fieldLabel: competitiveFieldLabel(competitorIndex, observationIndex, normalizedField),
      message: competitiveFieldMessage(path, competitor, observation),
      severity
    };
  };

  return [
    ...(validation?.errors || []).map((path) => mapPath(path, 'error')),
    ...(validation?.warnings || []).map((path) => mapPath(path, 'warning'))
  ].filter(Boolean);
};

export const presentQuestionValidation = (question, wasSubmitted = false) => {
  if (!wasSubmitted || String(question || '').trim()) return [];
  return [{
    id: 'lia-question-required',
    path: 'question',
    targetId: 'sales-agent-question',
    fieldLabel: 'Pregunta libre',
    message: 'Escribe una pregunta antes de iniciar el análisis.',
    severity: 'error'
  }];
};

export const getValidationFieldProps = (issue, describedBy = []) => {
  const ids = [...new Set([...describedBy, issue?.id].filter(Boolean))];
  return {
    // Keep the control's accessible name stable when the visible error is rendered
    // inside a label wrapper. The issue stays available through aria-describedby.
    'aria-label': issue?.fieldLabel || undefined,
    'aria-invalid': issue?.severity === 'error' ? 'true' : undefined,
    'aria-describedby': ids.length ? ids.join(' ') : undefined
  };
};

export const focusLiaValidationTarget = (targetId) => {
  if (!targetId || typeof document === 'undefined') return;
  const target = document.getElementById(targetId);
  if (!target) return;
  if (target.disabled) {
    const fallback = (target.getAttribute('aria-describedby') || '')
      .split(/\s+/u)
      .map((id) => document.getElementById(id))
      .find((element) => element?.classList.contains('lia-field-issue'));
    if (fallback) {
      fallback.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
      fallback.focus?.({ preventScroll: true });
    }
    return;
  }
  target.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
  target.focus?.({ preventScroll: true });
};
