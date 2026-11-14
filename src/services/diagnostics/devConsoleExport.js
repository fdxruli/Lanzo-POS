// Only primitive fields already projected by devConsoleCapture are eligible.
// Never enumerate objects, invoke getters or stringify a logged application payload.
const MAX_EXPORT_CHARS = 120_000;

const ownValue = (value, field) => {
  if (!value || typeof value !== 'object') return undefined;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, field);
    return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
  } catch { return undefined; }
};

const textField = (value, field, max = 12000) => {
  const fieldValue = ownValue(value, field);
  return typeof fieldValue === 'string' ? fieldValue.slice(0, max) : '';
};

const numberField = (value, field) => {
  const number = ownValue(value, field);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
};

// Best effort, not anonymous-by-guarantee. The editable review is mandatory.
export const redactDevConsoleExport = (text) => {
  if (typeof text !== 'string') return '';
  return text
    .replace(/-----BEGIN (?:[A-Z ]*PRIVATE KEY|CERTIFICATE)-----[\s\S]*?-----END (?:[A-Z ]*PRIVATE KEY|CERTIFICATE)-----/g, '[REDACTADO: BLOQUE PEM]')
    .replace(/https?:\/\/[^\s<>"'()\]]+/gi, (url) => {
      const noCredentials = url.replace(/\/\/[^/@\s]+@/, '//[REDACTADO]@');
      const firstPrivatePart = noCredentials.search(/[?#]/);
      return firstPrivatePart === -1 ? noCredentials
        : noCredentials.slice(0, firstPrivatePart) + '?[PARAMETROS_REDACTADOS]';
    })
    .replace(/\b(Authorization\s*:\s*(?:Bearer|Basic)\s+)[^\s,;]+/gi, '$1[REDACTADO]')
    .replace(/\b(Authorization\s*:\s*)(?!Bearer\b|Basic\b)[^\s,;]+/gi, '$1[REDACTADO]')
    .replace(/\b((?:Bearer|Basic)\s+)[A-Za-z0-9._~+/-]{12,}={0,2}/gi, '$1[REDACTADO]')
    .replace(/\b(?:eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)\b/g, '[REDACTADO: JWT]')
    .replace(/\b(?:sk_(?:live|test)_|sk-|sb_secret_|AIza)[A-Za-z0-9_-]{8,}\b/g, '[REDACTADO: CLAVE]')
    .replace(/\b((?:set-cookie|cookie)\s*:\s*)[^\r\n]+/gi, '$1[REDACTADO]')
    .replace(/\b((?:password|passwd|secret|client_secret|api[_-]?key|apikey|refresh[_-]?token|access[_-]?token|id[_-]?token|session[_-]?token|jwt|token|license[_-]?key)\s*["']?\s*[:=]\s*)(["'])(?:[^\\]|\\.)*?\2/gi, '$1$2[REDACTADO]$2')
    .replace(/\b((?:password|passwd|secret|client_secret|api[_-]?key|apikey|refresh[_-]?token|access[_-]?token|id[_-]?token|session[_-]?token|jwt|token|license[_-]?key)\s*["']?\s*[:=]\s*["']?)[^\s&,"'<>}]+/gi, '$1[REDACTADO]')
    .replace(/\b((?:(?:user|tenant|business|customer|client|actor|staff|owner)[_-]?(?:id|key)|tenantOpaqueId|actorKey|sessionId|session[_-]?id|deviceFingerprint|device[_-]?id|uid)\s*["']?\s*[:=]\s*["']?)[A-Za-z0-9_-]{8,}(?![A-Za-z0-9_-])/gi, '$1[REDACTADO]')
    .replace(/\b([A-Z0-9._%+-]+)@([A-Z0-9.-]+\.[A-Z]{2,})\b/gi, '[CORREO_REDACTADO]')
    .replace(/(?<!\d)\d{13,19}(?!\d)/g, '[NUMERO_LARGO_REDACTADO]')
    .replace(/(?<![\d-])(?:\+?52[\s.-]?)?(?:\d{10}|\d{2}[\s.-]\d{4}[\s.-]\d{4}|\d{3}[\s.-]\d{3}[\s.-]\d{4})(?!\d)/g, '[TELEFONO_REDACTADO]')
    .replace(/(?:[A-Z]:\\Users\\|\/Users\/|\/home\/)[^\\/\s:]+/gi, '[RUTA_USUARIO_REDACTADA]')
    .replace(/\b((?:customer|cliente|patient|paciente)\s*[:=]\s*)[^\n,;]+/gi, '$1[REDACTADO]')
    .replace(/\b((?:amount|importe|monto|balance)\s*[:=]\s*)\$?[-+]?\d[\d,.]*/gi, '$1[REDACTADO]');
};

const renderEntry = (entry) => {
  const technical = ownValue(entry, 'technical');
  const stamp = textField(entry, 'timestamp', 40);
  const level = textField(entry, 'level', 20).toUpperCase() || 'LOG';
  const source = textField(entry, 'source', 40);
  const lines = [
    '[' + level + '] ' + stamp,
    'Origen: ' + (source || 'No determinado')
  ];
  const code = textField(entry, 'code', 120);
  const category = textField(entry, 'category', 80);
  const severity = textField(entry, 'severity', 80);
  if (code) lines.push('Clasificación LANZO: ' + code);
  if (category) lines.push('Categoría: ' + category);
  if (severity) lines.push('Impacto: ' + severity);
  const operation = textField(entry, 'operation', 100);
  if (operation) lines.push('Operación: ' + operation);
  const summary = textField(entry, 'text', 5000);
  if (summary) lines.push('Resumen LANZO:\n' + summary);
  const evidence = textField(entry, 'evidence', 1200);
  if (evidence) lines.push('Dato técnico: ' + evidence);
  const count = numberField(entry, 'count');
  if (count && count > 1) {
    lines.push('Eventos equivalentes: ' + count);
    const first = textField(entry, 'firstTimestamp', 40);
    if (first) lines.push('Primer evento: ' + first);
  }
  if (technical && typeof technical === 'object') {
    const fields = [
      ['name', 'Tipo original', 120],
      ['code', 'Código original', 120],
      ['message', 'Mensaje original', 2400],
      ['stack', 'Stack original', 12000],
      ['details', 'Detalles PostgREST', 2400],
      ['hint', 'Hint PostgREST', 1600],
      ['filename', 'Archivo', 600]
    ];
    for (const [field, label, limit] of fields) {
      const original = textField(technical, field, limit);
      if (original) lines.push(label + ':\n' + original);
    }
    const status = numberField(technical, 'status');
    if (status && status >= 100 && status <= 599) lines.push('HTTP: ' + status);
    const line = numberField(technical, 'line');
    const column = numberField(technical, 'column');
    if (line) lines.push('Línea: ' + line);
    if (column) lines.push('Columna: ' + column);
    if (ownValue(technical, 'resourceError') === true) lines.push('Error de carga de recurso');
  }
  return lines.join('\n');
};

/**
 * Select most recent complete entries within the mobile-safe total limit,
 * then restore chronological order. Never cut a stack halfway through.
 * The output is always redacted before being returned to the UI.
 */
export const prepareDevConsoleExport = (entries) => {
  if (!Array.isArray(entries) || entries.length === 0) {
    return { text: '', included: 0, omitted: 0 };
  }
  const selected = [];
  let used = 0;
  let omitted = 0;
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const rendered = renderEntry(entries[index]);
    if (used + rendered.length + 80 > MAX_EXPORT_CHARS) { omitted += 1; continue; }
    selected.push(rendered);
    used += rendered.length + 80;
  }
  selected.reverse();
  const header = [
    'LANZO POS — DIAGNÓSTICO TÉCNICO',
    'Registros incluidos: ' + selected.length,
    ...(omitted ? ['Registros anteriores omitidos por límite de tamaño: ' + omitted] : []),
    'Revise y elimine cualquier dato privado antes de compartir.',
    '----------------------------------------'
  ];
  const text = selected.length ? [...header, ...selected, '----------------------------------------', 'Fin del diagnóstico.'].join('\n\n') : '';
  return { text: redactDevConsoleExport(text), included: selected.length, omitted };
};
