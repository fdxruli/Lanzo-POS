import { CUSTOMER_MESSAGE_EVENT_TYPES } from './contracts';
import { CUSTOMER_MESSAGE_TEMPLATE_SCHEMA_VERSION } from './defaultTemplates';
import { getAllowedTemplateVariableKeys, getRequiredTemplateVariableKeys, TEMPLATE_VARIABLE_PATTERN } from './templateVariables';

export const TEMPLATE_LIMITS = Object.freeze({ title: 100, body: 5000, footer: 500, variables: 60, lines: 160 });
const unsafeText = /<\/?[a-z][^>]*>|javascript\s*:|data\s*:\s*text\/html|https?:\/\/|\bwww\./i;
// Reject money notation but keep ordinary quantities and dates available to copy.
const handwrittenMoney = /(?:[$€£]\s*\d+(?:[.,]\d{3})*(?:[.,]\d{1,2})?|\b\d{1,3}(?:,\d{3})*\.\d{2}\b|\b\d{1,3}(?:\.\d{3})*,\d{2}\b|\b\d+[,.]\d{2}\b)/;
const fields = ['title', 'body', 'footer'];

const variablesIn = (text) => [...String(text || '').matchAll(TEMPLATE_VARIABLE_PATTERN)].map((match) => match[1]);

export const validateCustomerMessageTemplate = (eventType, candidate) => {
  const errors = [];
  if (!CUSTOMER_MESSAGE_EVENT_TYPES.includes(eventType)) errors.push({ code: 'TEMPLATE_EVENT_UNSUPPORTED' });
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return { ok: false, errors: [{ code: 'TEMPLATE_INVALID' }] };
  if (candidate.schemaVersion !== CUSTOMER_MESSAGE_TEMPLATE_SCHEMA_VERSION) errors.push({ code: 'TEMPLATE_SCHEMA_UNSUPPORTED' });
  if (Object.keys(candidate).some((key) => !['schemaVersion', ...fields].includes(key))) errors.push({ code: 'TEMPLATE_FIELD_UNSUPPORTED' });
  fields.forEach((field) => {
    const value = candidate[field];
    if (typeof value !== 'string') errors.push({ code: 'TEMPLATE_TEXT_INVALID', field });
    else {
      if ((field === 'title' || field === 'body') && !value.trim()) errors.push({ code: 'TEMPLATE_TEXT_REQUIRED', field });
      if (value.length > TEMPLATE_LIMITS[field]) errors.push({ code: 'TEMPLATE_TEXT_TOO_LONG', field });
      if (unsafeText.test(value)) errors.push({ code: 'TEMPLATE_UNSAFE_TEXT', field });
      if (handwrittenMoney.test(value)) errors.push({ code: 'TEMPLATE_HANDWRITTEN_FINANCIAL_VALUE', field });
    }
  });
  const variableKeys = fields.flatMap((field) => variablesIn(candidate[field]));
  if (variableKeys.length > TEMPLATE_LIMITS.variables) errors.push({ code: 'TEMPLATE_VARIABLE_LIMIT' });
  const allowed = new Set(getAllowedTemplateVariableKeys(eventType));
  const unknownVariables = [...new Set(variableKeys.filter((key) => !allowed.has(key)))];
  if (unknownVariables.length) errors.push({ code: 'TEMPLATE_VARIABLE_UNSUPPORTED', variables: unknownVariables });
  const required = getRequiredTemplateVariableKeys(eventType);
  const missingVariables = required.filter((key) => !variableKeys.includes(key));
  if (missingVariables.length) errors.push({ code: 'TEMPLATE_REQUIRED_VARIABLE_MISSING', variables: missingVariables.map((key) => `{{${key}}}`) });
  if (fields.reduce((count, field) => count + String(candidate[field] || '').split('\n').length, 0) > TEMPLATE_LIMITS.lines) errors.push({ code: 'TEMPLATE_LINE_LIMIT' });
  return { ok: errors.length === 0, errors, missingVariables: missingVariables.map((key) => `{{${key}}}`) };
};
