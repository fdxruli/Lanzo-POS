import { describe, expect, it } from 'vitest';
import {
  MAX_TELEGRAM_MESSAGE_CODEPOINTS,
  TELEGRAM_CONTACT_BASE_URL,
  TELEGRAM_CONTACT_INTENT,
  buildTelegramContactMessage,
  buildTelegramContactUrl,
  createTelegramContact,
  sanitizeTelegramBusinessName
} from '../telegramContact';

const AUTHORIZED_LOCAL_CONTEXT = Object.freeze({
  isAuthorizedCommercialAdmin: true,
  licenseState: 'local_active',
  planName: 'Lanzo Local',
  workMode: 'team',
  businessName: 'Café Niña & Socios 🌿'
});

describe('telegramContact', () => {
  it('builds links only to the official HTTPS Telegram account', () => {
    const contact = createTelegramContact(TELEGRAM_CONTACT_INTENT.PRO_INQUIRY);
    const url = new URL(contact.url);

    expect(`${url.origin}${url.pathname}`).toBe(TELEGRAM_CONTACT_BASE_URL);
    expect([...url.searchParams.keys()]).toEqual(['text']);
    expect(url.searchParams.get('text')).toBe(contact.message);
  });

  it('encodes accents, emoji, line breaks and special characters for Telegram', () => {
    const contact = createTelegramContact(TELEGRAM_CONTACT_INTENT.PRO_INQUIRY, AUTHORIZED_LOCAL_CONTEXT);
    const url = new URL(contact.url);

    expect(contact.message).toContain('Café Niña & Socios 🌿');
    expect(url.searchParams.get('text')).toBe(contact.message);
    expect(contact.url).toContain('%C3%A9');
    expect(contact.url).toContain('%0A');
    expect(contact.url).toContain('%F0%9F');
  });

  it('uses distinct natural-language copy for commercial intents and support', () => {
    const inquiry = buildTelegramContactMessage(TELEGRAM_CONTACT_INTENT.PRO_INQUIRY);
    const activation = buildTelegramContactMessage(TELEGRAM_CONTACT_INTENT.PRO_ACTIVATION);
    const support = buildTelegramContactMessage(TELEGRAM_CONTACT_INTENT.GENERAL_SUPPORT);
    const renewal = buildTelegramContactMessage(TELEGRAM_CONTACT_INTENT.PRO_RENEWAL);

    expect(inquiry).toContain('conocer las ventajas');
    expect(activation).toContain('contratar Lanzo Nube');
    expect(support).toContain('consulta sobre Lanzo POS');
    expect(renewal).toContain('renovar o dar continuidad');
    expect(new Set([inquiry, activation, support, renewal]).size).toBe(4);
    expect(activation).not.toContain('$300');
  });

  it('falls back to general support for unknown or missing intents', () => {
    expect(buildTelegramContactMessage('unexpected')).toBe(
      buildTelegramContactMessage(TELEGRAM_CONTACT_INTENT.GENERAL_SUPPORT)
    );
    expect(buildTelegramContactMessage()).toContain('consulta sobre Lanzo POS');
  });

  it('omits business context unless an authorized commercial admin has a known plan state', () => {
    const unauthorized = createTelegramContact(TELEGRAM_CONTACT_INTENT.PRO_ACTIVATION, {
      ...AUTHORIZED_LOCAL_CONTEXT,
      isAuthorizedCommercialAdmin: false
    });
    const unknownState = createTelegramContact(TELEGRAM_CONTACT_INTENT.PRO_ACTIVATION, {
      ...AUTHORIZED_LOCAL_CONTEXT,
      licenseState: 'unknown'
    });

    expect(unauthorized.message).not.toContain('Café Niña');
    expect(unauthorized.message).not.toContain('Lanzo Local');
    expect(unknownState.message).not.toContain('Café Niña');
    expect(unknownState.message).not.toContain('Trabajo con un equipo');
  });

  it('omits all context if the selected plan does not agree with the confirmed license state', () => {
    const mismatchedPlan = createTelegramContact(TELEGRAM_CONTACT_INTENT.PRO_ACTIVATION, {
      ...AUTHORIZED_LOCAL_CONTEXT,
      planName: 'Lanzo Nube'
    });

    expect(mismatchedPlan.message).not.toContain('Café Niña');
    expect(mismatchedPlan.message).not.toContain('Lanzo Nube.');
    expect(mismatchedPlan.message).not.toContain('Trabajo con un equipo.');
  });

  it('omits sensitive values and identifiers from a business name', () => {
    const context = {
      ...AUTHORIZED_LOCAL_CONTEXT,
      businessName: 'LANZO-750F-AC06-6720-FDCA'
    };
    const message = buildTelegramContactMessage(TELEGRAM_CONTACT_INTENT.PRO_ACTIVATION, context);

    expect(message).not.toContain('LANZO-750F-AC06-6720-FDCA');
    expect(message).not.toContain('Mi negocio se llama');
  });

  it('normalizes control characters and limits business names to 48 codepoints', () => {
    const sanitized = sanitizeTelegramBusinessName(`  Mi\u0000  Tienda\n  ${'X'.repeat(60)}  `);

    expect(sanitized.startsWith('Mi Tienda')).toBe(true);
    expect(Array.from(sanitized).length).toBe(48);
    expect(sanitized).not.toMatch(/[\u0000-\u001F\u007F-\u009F]/);
  });

  it('caps generated messages and never accepts an arbitrary URL target', () => {
    const context = {
      ...AUTHORIZED_LOCAL_CONTEXT,
      businessName: 'Z'.repeat(2000),
      username: 'attacker',
      baseUrl: 'https://attacker.example'
    };
    const url = new URL(buildTelegramContactUrl(TELEGRAM_CONTACT_INTENT.PRICING_INQUIRY, context));

    expect(`${url.origin}${url.pathname}`).toBe(TELEGRAM_CONTACT_BASE_URL);
    expect(Array.from(url.searchParams.get('text')).length).toBeLessThanOrEqual(MAX_TELEGRAM_MESSAGE_CODEPOINTS);
    expect(url.searchParams.get('text')).toContain('Z'.repeat(48));
  });

  it('does not mutate the context provided by the caller', () => {
    const context = Object.freeze({ ...AUTHORIZED_LOCAL_CONTEXT });
    expect(() => buildTelegramContactMessage(TELEGRAM_CONTACT_INTENT.PRO_ACTIVATION, context)).not.toThrow();
    expect(context).toEqual(AUTHORIZED_LOCAL_CONTEXT);
  });

  it.each([
    ['uppercase UUID', '550E8400-E29B-41D4-A716-446655440000'],
    ['lowercase UUID', '550e8400-e29b-41d4-a716-446655440000'],
    ['mixed-case UUID', '550E8400-e29b-41D4-a716-446655440000'],
    ['uppercase hexadecimal identifier', 'ABCDEF1234567890ABCDEF1234567890'],
    ['lowercase hexadecimal identifier', 'abcdef1234567890abcdef1234567890'],
    ['Lanzo license', 'LANZO-750F-AC06-6720-FDCA'],
    ['JWT-shaped credential', 'abcdefghijk.abcdefghijk.abcdefghijk']
  ])('excludes a %s from authorized Telegram business context', (_case, businessName) => {
    expect(sanitizeTelegramBusinessName(businessName)).toBe('');
    const message = buildTelegramContactMessage(TELEGRAM_CONTACT_INTENT.PRO_ACTIVATION, {
      ...AUTHORIZED_LOCAL_CONTEXT,
      businessName
    });
    expect(message).not.toContain(businessName);
    expect(message).not.toContain('Mi negocio se llama');
  });

  it('preserves an ordinary uppercase business name and the fixed Telegram destination', () => {
    expect(sanitizeTelegramBusinessName('CAFETERIA LAS ALAS')).toBe('CAFETERIA LAS ALAS');
    const message = buildTelegramContactMessage(TELEGRAM_CONTACT_INTENT.PRO_ACTIVATION, {
      ...AUTHORIZED_LOCAL_CONTEXT,
      businessName: 'CAFETERIA LAS ALAS'
    });
    expect(message).toContain('CAFETERIA LAS ALAS');
    const url = new URL(buildTelegramContactUrl(TELEGRAM_CONTACT_INTENT.PRO_ACTIVATION, AUTHORIZED_LOCAL_CONTEXT));
    expect(url.origin + url.pathname).toBe(TELEGRAM_CONTACT_BASE_URL);
  });

});
