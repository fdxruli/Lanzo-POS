import { describe, expect, it } from 'vitest';
import { CUSTOMER_MESSAGE_EVENT_TYPES } from '../contracts';
import { CUSTOMER_MESSAGE_DEFAULT_TEMPLATES, getDefaultCustomerMessageTemplate } from '../defaultTemplates';
import { buildImageReceiptModel } from '../imageRenderer';
import { buildCustomerMessageTemplatePreviewPayload } from '../templatePreview';
import { getAllowedTemplateVariableKeys, getRequiredTemplateVariableKeys, getTemplateVariablesForEvent } from '../templateVariables';
import { validateCustomerMessageTemplate } from '../templateValidator';

describe('customer message template catalogue and validation', () => {
  it('provides schema-versioned defaults and allowed required variables for every event', () => {
    expect(Object.keys(CUSTOMER_MESSAGE_DEFAULT_TEMPLATES)).toEqual(CUSTOMER_MESSAGE_EVENT_TYPES);
    CUSTOMER_MESSAGE_EVENT_TYPES.forEach((eventType) => {
      expect(getDefaultCustomerMessageTemplate(eventType)).toMatchObject({ schemaVersion: 1 });
      expect(getAllowedTemplateVariableKeys(eventType)).toContain('business.name');
      expect(getRequiredTemplateVariableKeys(eventType)).toContain('customer.name');
      expect(validateCustomerMessageTemplate(eventType, getDefaultCustomerMessageTemplate(eventType)).ok).toBe(true);
      getDefaultCustomerMessageTemplate(eventType).body.match(/{{[^}]+}}/g)?.forEach((token) => {
        const variable = getTemplateVariablesForEvent(eventType).find((item) => item.token === token);
        expect(variable).toMatchObject({ token, definition: expect.any(String), purpose: expect.any(String), type: expect.any(String), example: expect.any(String) });
      });
    });
  });

  it('rejects unsafe, cross-event, missing, oversized, and incompatible templates', () => {
    const valid = structuredClone(getDefaultCustomerMessageTemplate('sale_paid'));
    expect(validateCustomerMessageTemplate('sale_paid', { ...valid, body: '{{layaway.total}}' })).toMatchObject({ ok: false });
    expect(validateCustomerMessageTemplate('sale_paid', { ...valid, body: '<b>{{sale.total}}</b>' })).toMatchObject({ ok: false });
    expect(validateCustomerMessageTemplate('sale_paid', { ...valid, footer: 'javascript:alert(1)' })).toMatchObject({ ok: false });
    ['$100', '$100.00', '100.00', '100,00', '1,000.00', '1.000,00', '€100', '£100'].forEach((money) => {
      expect(validateCustomerMessageTemplate('sale_paid', { ...valid, footer: money })).toMatchObject({ ok: false });
    });
    expect(validateCustomerMessageTemplate('sale_paid', { ...valid, schemaVersion: 2 })).toMatchObject({ ok: false });
    expect(validateCustomerMessageTemplate('sale_paid', { ...valid, title: 'x'.repeat(101) })).toMatchObject({ ok: false });
  });

  it('uses custom copy only when the template is valid and never exposes internal identifiers', () => {
    const payload = buildCustomerMessageTemplatePreviewPayload('sale_paid');
    const template = { ...getDefaultCustomerMessageTemplate('sale_paid'), title: 'Hola {{customer.name}}' };
    const custom = buildImageReceiptModel(payload, { template });
    const fallback = buildImageReceiptModel(payload, { template: { ...template, body: '{{sale.id}}' } });
    expect(custom.model.title).toBe('Hola María Cliente');
    expect(custom.model.sections.join('\n')).toContain('$250.00');
    expect(custom.model.sections.join('\n')).not.toContain('preview-sale');
    expect(fallback.model.isCustomTemplate).toBeUndefined();
    expect(fallback.model.rows.map((row) => row.value).join('\n')).not.toContain('preview-sale');
  });
});
