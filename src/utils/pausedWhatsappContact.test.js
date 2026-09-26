import { describe, expect, it } from 'vitest';
import { buildPausedWhatsappUrl, normalizePausedWhatsappPhone } from './pausedWhatsappContact';

describe('paused WhatsApp contact', () => {
  it.each([
    ['529610000000', '529610000000'],
    ['+52 (961) 000-0000', '529610000000'],
    [null, ''], ['', ''], ['   ', ''], ['1234567', ''],
    ['+52 abc 9610000000', ''], ['https://evil.test/529610000000', ''],
    ['javascript:alert(1)', ''], ['1234567890123456', '']
  ])('normalizes %s safely', (value, expected) => {
    expect(normalizePausedWhatsappPhone(value)).toBe(expected);
    expect(buildPausedWhatsappUrl(value)).toBe(expected ? `https://wa.me/${expected}` : '');
  });
});
