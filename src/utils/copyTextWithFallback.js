export async function copyTextWithFallback(
  value,
  {
    navigatorRef = globalThis.navigator,
    documentRef = globalThis.document
  } = {}
) {
  const text = typeof value === 'string' ? value : '';
  if (!text) return false;

  try {
    if (navigatorRef?.clipboard?.writeText) {
      await navigatorRef.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Continue with the local document fallback.
  }

  if (!documentRef?.body || typeof documentRef.execCommand !== 'function') return false;

  const textarea = documentRef.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  textarea.style.pointerEvents = 'none';
  documentRef.body.appendChild(textarea);
  textarea.select();

  try {
    return documentRef.execCommand('copy') === true;
  } catch {
    return false;
  } finally {
    textarea.remove();
  }
}

