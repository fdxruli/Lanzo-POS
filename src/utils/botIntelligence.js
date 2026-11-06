import { BOT_GUIDES, getBotScreen } from '../config/botKnowledge';
import { BOT_RUBROS } from '../config/botContextByRubro';
import { INTENT_PATTERNS } from './IntentPatterns';
import { normalizeText, extractTimeframe } from './nlpEngine';

export const detectIntent = (text) => {
  const normalized = normalizeText(text);
  const exact = BOT_GUIDES.find(guide => normalizeText(guide.question) === normalized);
  if (exact) return exact.id;
  if (!/^(?:como|donde|pasos|ayuda para)/.test(normalized)) {
    for (const [intent, patterns] of Object.entries(INTENT_PATTERNS)) {
      if (patterns.some(pattern => pattern.test(normalized))) return intent;
    }
  }
  if (/pedido.*(?:online|linea|web)/.test(normalized)) return 'online_orders';
  return BOT_GUIDES.find(guide => guide.patterns.some(pattern => pattern.test(normalized)))?.id || 'unknown';
};

export const processBotMessage = async (text, context = {}) => {
  const intent = detectIntent(text);
  if (Object.hasOwn(INTENT_PATTERNS, intent)) {
    const timeframe = extractTimeframe(text);
    if (!timeframe) return { title: 'Elige un período', message: 'Puedo consultar hoy, ayer, esta semana, semana pasada, este mes, mes pasado o los últimos 1 a 366 días. Indica uno de esos períodos para evitar una cifra de fechas incorrectas.' };
    return { kind: 'read', intent, timeframe };
  }
  const screen = getBotScreen(context.pathname, context.search, context.tab);
  const guide = BOT_GUIDES.find(item => item.id === intent);
  const rubro = BOT_RUBROS[context.businessType];
  const steps = intent === 'kitchen' && !context.cloud ? [
    'En Pedidos → Cocina localiza la comanda por mesa, hora y artículos.',
    'Cuando termine la preparación pulsa ¡LISTO! y comprueba que aparezca en Entrega.',
    'Cuando se entregue pulsa ENTREGADO y verifica el registro en Historial. El estado de cocina no confirma que la cuenta esté pagada.'
  ] : guide?.steps;
  if (guide) return {
    title: guide.title,
    message: steps.map((step, index) => `${index + 1}. ${step}`).join('\n\n'),
    tips: [
      ...(context.cloud && context.online === false ? ['Estás sin conexión. Estas instrucciones siguen disponibles; las acciones Nube que la pantalla bloquee requieren reconexión.'] : []),
      ...(['sale', 'scan', 'cart', 'batches', 'product', 'tables'].includes(intent) && rubro ? [rubro.tip] : []),
      ...(context.actorType === 'staff' ? ['Si una opción no aparece, solicita al administrador revisar los permisos y las funciones de tu plan.'] : [])
    ],
    actions: [{ label: `Abrir ${guide.title}`, path: guide.path }]
  };
  return {
    title: /^(hola|buenos dias|buenas|gracias)\b/.test(normalizeText(text)) ? 'Hola, soy Lanzó Bot' : 'Vamos a concretar la consulta',
    message: `Estás en ${screen.label}. Puedo explicar los pasos para usar LANZO POS y consultar datos cuando tu sesión tenga permiso. Elige una tarea o indica qué intentas hacer.`,
    options: screen.guides.slice(0, 3).map(item => ({ label: item.question, query: item.question }))
  };
};
