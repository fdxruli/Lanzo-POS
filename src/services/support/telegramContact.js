export const TELEGRAM_USERNAME = 'LanzoPOS_Oficial';
export const TELEGRAM_CONTACT_BASE_URL = `https://t.me/${TELEGRAM_USERNAME}`;
export const TELEGRAM_SHARE_BASE_URL = 'https://t.me/share/url';
// Telegram direct messages are configurable per channel. The public page for
// this channel could not be inspected, so callers must not treat it as a chat.
export const TELEGRAM_CHANNEL_DIRECT_MESSAGES_STATUS = 'unverified';
export const DIRECT_TELEGRAM_SUPPORT_UNVERIFIED = 'DIRECT_TELEGRAM_SUPPORT_UNVERIFIED';
export const TELEGRAM_SUPPORT_CONFIGURATION = Object.freeze({
  destination: 'public_channel_reference',
  username: TELEGRAM_USERNAME,
  directMessagesStatus: TELEGRAM_CHANNEL_DIRECT_MESSAGES_STATUS,
  statusCode: DIRECT_TELEGRAM_SUPPORT_UNVERIFIED
});
export const MAX_TELEGRAM_MESSAGE_CODEPOINTS = 1200;

export const buildTelegramSupportTarget = () => Object.freeze({
  kind: 'channel_reference',
  status: TELEGRAM_SUPPORT_CONFIGURATION.statusCode,
  username: TELEGRAM_SUPPORT_CONFIGURATION.username,
  url: TELEGRAM_CONTACT_BASE_URL,
  preparedMessageIncluded: false
});

export const TELEGRAM_CONTACT_INTENT = Object.freeze({
  PRO_INQUIRY: 'pro_inquiry',
  PRO_ACTIVATION: 'pro_activation',
  PRO_RENEWAL: 'pro_renewal',
  PRO_REACTIVATION: 'pro_reactivation',
  GENERAL_SUPPORT: 'general_support',
  PRO_SUPPORT: 'pro_support',
  PRICING_INQUIRY: 'pricing_inquiry'
});

const KNOWN_INTENTS = new Set(Object.values(TELEGRAM_CONTACT_INTENT));
const COMMERCIAL_INTENTS = new Set([
  TELEGRAM_CONTACT_INTENT.PRO_INQUIRY,
  TELEGRAM_CONTACT_INTENT.PRO_ACTIVATION,
  TELEGRAM_CONTACT_INTENT.PRO_RENEWAL,
  TELEGRAM_CONTACT_INTENT.PRO_REACTIVATION,
  TELEGRAM_CONTACT_INTENT.PRO_SUPPORT,
  TELEGRAM_CONTACT_INTENT.PRICING_INQUIRY
]);
const KNOWN_LICENSE_CONTEXT_STATES = new Set([
  'local_active',
  'cloud_active',
  'cloud_grace',
  'cloud_expired'
]);
const ALLOWED_PLAN_NAMES = new Set(['Lanzo Local', 'Lanzo Nube']);
// Control characters must be stripped before any user-provided text is shared.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F-\u009F]/g;
const RESTRICTED_BUSINESS_NAME_PATTERNS = [
  /\bLANZO-(?:[A-Z0-9]{4}-){2,}[A-Z0-9]{4}\b/i,
  /\b[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\b/i,
  /\b[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
  /\b(?:license[\s_-]*key|clave\s+de\s+licencia|token|jwt|fingerprint|huella(?:\s+digital)?|pin|password|contrase(?:ñ|n)a|tenant(?:[\s_-]*id)?|uuid)\b/i,
  /\b(?:LanzoDB_t_|t_)[A-Za-z0-9_-]{8,}\b/i,
  /\bBearer\s+[A-Za-z0-9._~-]{12,}\b/i,
  /\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/,
  /\+?\d[\d\s().-]{7,}\d/,
  /\b(?:calle|avenida|colonia|c\.p\.|código postal|direccion|dirección|address)\b/i,
  /\b[a-f\d]{24,}\b/i
];

const INTENT_COPY = Object.freeze({
  [TELEGRAM_CONTACT_INTENT.PRO_INQUIRY]: {
    request: 'Quisiera conocer las ventajas de Lanzo Nube y saber si se adapta a mi negocio.',
    close: '¿Podrían orientarme?'
  },
  [TELEGRAM_CONTACT_INTENT.PRO_ACTIVATION]: {
    request: 'Me interesa contratar Lanzo Nube y quisiera conocer los pasos para solicitar la activación.',
    close: '¿Podrían ayudarme y confirmar las condiciones vigentes?'
  },
  [TELEGRAM_CONTACT_INTENT.PRO_RENEWAL]: {
    request: 'Ya utilizo Lanzo Nube y quisiera consultar las opciones vigentes para renovar o dar continuidad al servicio.',
    close: '¿Podrían orientarme?'
  },
  [TELEGRAM_CONTACT_INTENT.PRO_REACTIVATION]: {
    request: 'Mi servicio de Lanzo Nube aparece vencido. Quisiera consultar si es posible reactivarlo y conocer los pasos.',
    close: '¿Podrían revisar mi situación?'
  },
  [TELEGRAM_CONTACT_INTENT.GENERAL_SUPPORT]: {
    request: 'Tengo una consulta sobre Lanzo POS y necesito orientación.',
    close: '¿Podrían apoyarme?'
  },
  [TELEGRAM_CONTACT_INTENT.PRO_SUPPORT]: {
    request: 'Ya utilizo Lanzo Nube y necesito ayuda con mi servicio.',
    close: '¿Podrían apoyarme?'
  },
  [TELEGRAM_CONTACT_INTENT.PRICING_INQUIRY]: {
    request: 'Quisiera conocer los precios y promociones vigentes de Lanzo Nube.',
    close: '¿Podrían orientarme?'
  }
});

const normalizeIntent = (intent) => (
  typeof intent === 'string' && KNOWN_INTENTS.has(intent)
    ? intent
    : TELEGRAM_CONTACT_INTENT.GENERAL_SUPPORT
);

export const sanitizeTelegramBusinessName = (value) => {
  if (typeof value !== 'string') return '';

  const normalized = value
    .normalize('NFKC')
    .replace(CONTROL_CHARACTERS, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!normalized || RESTRICTED_BUSINESS_NAME_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return '';
  }

  return Array.from(normalized).slice(0, 48).join('');
};

const normalizeContext = (intent, context = {}) => {
  const expectedPlanName = context?.licenseState === 'local_active' ? 'Lanzo Local' : 'Lanzo Nube';
  const mayShareBusinessContext = (
    COMMERCIAL_INTENTS.has(intent)
    && context?.isAuthorizedCommercialAdmin === true
    && KNOWN_LICENSE_CONTEXT_STATES.has(context?.licenseState)
    && context?.planName === expectedPlanName
  );
  const businessName = mayShareBusinessContext
    ? sanitizeTelegramBusinessName(context?.businessName)
    : '';
  const planName = mayShareBusinessContext && ALLOWED_PLAN_NAMES.has(context?.planName)
    ? context.planName
    : '';
  const workMode = mayShareBusinessContext && ['solo', 'team'].includes(context?.workMode)
    ? context.workMode
    : '';

  return { businessName, planName, workMode };
};

const buildContextLines = ({ businessName, planName, workMode }, intent) => {
  const lines = [];

  if (planName && !(planName === 'Lanzo Nube' && [
    TELEGRAM_CONTACT_INTENT.PRO_SUPPORT,
    TELEGRAM_CONTACT_INTENT.PRO_RENEWAL,
    TELEGRAM_CONTACT_INTENT.PRO_REACTIVATION
  ].includes(intent))) {
    lines.push(`Mi plan actual es ${planName}.`);
  }

  if (workMode === 'solo') lines.push('Vendo desde un equipo.');
  if (workMode === 'team') lines.push('Trabajo con un equipo.');
  if (businessName) lines.push(`Mi negocio se llama ${businessName}.`);

  return lines;
};

const limitMessageLength = (message) => (
  Array.from(String(message || '').trim()).slice(0, MAX_TELEGRAM_MESSAGE_CODEPOINTS).join('')
);

export const buildTelegramContactMessage = (intent, context = {}) => {
  const normalizedIntent = normalizeIntent(intent);
  const copy = INTENT_COPY[normalizedIntent];
  const contextLines = buildContextLines(normalizeContext(normalizedIntent, context), normalizedIntent);
  const message = [
    'Hola, equipo Lanzo-POS.',
    '',
    copy.request,
    ...(contextLines.length ? ['', ...contextLines] : []),
    '',
    copy.close
  ].join('\n');

  return limitMessageLength(message);
};

export const buildTelegramShareUrl = (message) => {
  const url = new URL(TELEGRAM_SHARE_BASE_URL);
  url.searchParams.set('url', TELEGRAM_CONTACT_BASE_URL);
  url.searchParams.set('text', limitMessageLength(message));

  return url.toString();
};

export const buildTelegramContactUrl = (intent, context = {}) => (
  buildTelegramShareUrl(buildTelegramContactMessage(intent, context))
);

export const createTelegramContact = (intent, context = {}) => {
  const normalizedIntent = normalizeIntent(intent);
  const message = buildTelegramContactMessage(normalizedIntent, context);

  return Object.freeze({
    intent: normalizedIntent,
    username: TELEGRAM_USERNAME,
    message,
    // The official share flow asks the user to choose a recipient. The
    // channel URL is shared as a reference; it is not treated as a DM target.
    url: buildTelegramShareUrl(message)
  });
};

export default Object.freeze({
  TELEGRAM_USERNAME,
  TELEGRAM_CONTACT_BASE_URL,
  TELEGRAM_SHARE_BASE_URL,
  TELEGRAM_CHANNEL_DIRECT_MESSAGES_STATUS,
  DIRECT_TELEGRAM_SUPPORT_UNVERIFIED,
  TELEGRAM_SUPPORT_CONFIGURATION,
  TELEGRAM_CONTACT_INTENT,
  buildTelegramSupportTarget,
  buildTelegramContactMessage,
  buildTelegramContactUrl,
  buildTelegramShareUrl,
  createTelegramContact,
  sanitizeTelegramBusinessName
});
