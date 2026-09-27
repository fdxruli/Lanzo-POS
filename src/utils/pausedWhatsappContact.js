// Stored public contact numbers may contain display punctuation, but never a URL.
export function normalizePausedWhatsappPhone(value) {
  if (typeof value !== 'string') return '';
  const candidate = value.trim();
  if (!candidate || !/^[+0-9().\s-]+$/u.test(candidate)) return '';
  const digits = candidate.replace(/\D/gu, '');
  return /^\d{8,15}$/u.test(digits) ? digits : '';
}

export function buildPausedWhatsappUrl(value) {
  const digits = normalizePausedWhatsappPhone(value);
  return digits ? `https://wa.me/${digits}` : '';
}
