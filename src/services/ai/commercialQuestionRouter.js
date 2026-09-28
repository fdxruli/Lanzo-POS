import { LIA_IDENTITY, createLiaIdentityAnswer } from './liaIdentity.js';

const normalizeQuestion = (value) => String(value || '')
  .toLowerCase()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[¿?¡!.,;:()[\]{}]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const hasValue = (value) => value !== undefined
  && value !== null
  && !(typeof value === 'string' && value.trim() === '');
const normalizedName = LIA_IDENTITY.name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

const route = (kind, details = {}) => ({
  kind,
  topic: details.topic || null,
  intent: details.intent || null,
  confidence: details.confidence || (kind === 'needs_context' ? 'low' : 'high'),
  requiresData: kind === 'supported',
  requiresProvider: kind === 'supported',
  ...details
});

const identityRules = [
  {
    topic: 'name_meaning',
    patterns: [
      /\b(?:por que|porque)\s+(?:te llamas|te pusieron|ese nombre)\b/u,
      new RegExp('\\b(?:por que|porque)\\s+se llama\\s+' + normalizedName + '\\b', 'u'),
      /\b(?:por que|porque)\s+lia\b/u,
      /\bpor que ese nombre\b/u,
      /\b(?:que significa|que quiere decir)\s+(?:(?:tu|el)\s+nombre|lia)\b/u,
      /\b(?:de donde|cual es el origen de)\s+(?:salio|viene|nace)?\s*(?:tu nombre|el nombre|lia)\b/u,
      /\bde donde salio tu nombre\b/u
    ]
  },
  {
    topic: 'name',
    patterns: [
      /\bcomo te llamas\b/u,
      /\bcual es tu nombre\b/u,
      /\bdime tu nombre\b/u,
      /\bcomo se llama la asistente\b/u,
      /\bcomo se llama el asistente\b/u
    ]
  },
  {
    topic: 'ai',
    patterns: [
      /\b(?:eres|estas hecha como|funcionas como)\s+(?:una?\s+)?(?:ia|inteligencia artificial)\b/u,
      /\b(?:eres un|eres una)\s+modelo de lenguaje\b/u
    ]
  },
  {
    topic: 'capabilities',
    patterns: [
      /\b(?:que puedes hacer|que sabes hacer|para que sirves|para que me ayudas|en que me puedes ayudar)\b/u,
      /\b(?:que haces|cuales son tus funciones|que tipo de consultas respondes)\b/u,
      new RegExp('\\bque puede hacer ' + normalizedName + '\\b', 'u')
    ]
  },
  {
    topic: 'identity',
    patterns: [
      /\b(?:quien eres|que eres)\b/u,
      new RegExp('\\b(?:quien|que) es ' + normalizedName + '\\b', 'u')
    ]
  }
];

const resolveIdentity = (text) => {
  for (const rule of identityRules) {
    if (rule.patterns.some((pattern) => pattern.test(text))) {
      return route('identity', { topic: rule.topic, confidence: 'high' });
    }
  }
  return null;
};

const resolution = (kind, details = {}) => route(kind, details);

const supported = (intent, options) => {
  if (intent === 'price_simulation' && Object.prototype.hasOwnProperty.call(options, 'scenario')) {
    const scenario = options.scenario && typeof options.scenario === 'object' ? options.scenario : {};
    const missingContext = [];
    if (!hasValue(scenario.productName)) missingContext.push('productName');
    if (!hasValue(scenario.newPrice)) missingContext.push('newPrice');
    if (missingContext.length) {
      return resolution('needs_context', {
        topic: 'price_simulation',
        intent,
        confidence: 'high',
        requiresData: false,
        requiresProvider: false,
        missingContext
      });
    }
  }
  return resolution('supported', { intent, topic: intent, confidence: 'high' });
};

const containsAny = (text, pattern) => pattern.test(text);

const EXPLICIT_OUT_OF_SCOPE = /\b(?:clima|tiempo hace|pronostico|receta|cocinar|cocina|futbol|deporte|partido|musica|pelicula|serie de television|politica|politic|presidente|chiste|horoscopo)\b/u;
const EXPLICIT_MODULE_QUERY = /\b(?:inventario|stock|existencias|ecommerce|tienda en linea|pedidos?)\b/u;

export const resolveCommercialIntent = (question = '', options = {}) => {
  const optionValues = options && typeof options === 'object' ? options : {};
  const text = normalizeQuestion(question);
  if (!text) {
    return resolution('needs_context', {
      topic: 'commercial_question',
      confidence: 'low',
      requiresData: false,
      requiresProvider: false,
      missingContext: ['question']
    });
  }

  const identity = resolveIdentity(text);
  if (identity) return identity;

  if (/^(?:hola|buenas|buenos dias|buenas tardes|buenas noches|que tal|saludos)$/u.test(text)) {
    return resolution('out_of_scope', { reason: 'greeting', topic: 'greeting' });
  }

  if (EXPLICIT_OUT_OF_SCOPE.test(text)) {
    return resolution('out_of_scope', { reason: 'unrelated', topic: 'unrelated' });
  }

  if (EXPLICIT_MODULE_QUERY.test(text)) {
    return resolution('out_of_scope', { reason: 'module', topic: 'module' });
  }

  if (containsAny(text, /\b(?:mis\s+)?clientes?\b/u)
    && containsAny(text, /\b(?:lista|listar|frecuentes|activos|inactivos|historial|quienes|consultar)\b/u)) {
    return resolution('out_of_scope', { reason: 'module', topic: 'module' });
  }

  if (containsAny(text, /\b(?:competencia|competencias|competidor(?:es)?|rivales?)\b/u)) {
    return resolution('recognized_not_supported', { topic: 'competition', confidence: 'high' });
  }

  if ((containsAny(text, /\b(?:incorpor|agreg|anad|introduc|meter)\w*\b/u)
      && containsAny(text, /\b(?:productos?|servicios?|oferta|surtido|catalogo|vender|clientela|clientes)\b/u))
    || containsAny(text, /\b(?:productos?|servicios?)\s+nuevos?\b/u)
    || containsAny(text, /\b(?:nuevos?|nuevas?)\s+(?:productos?|servicios?)\b/u)
    || containsAny(text, /\bque otra cosa puedo vender\b/u)
    || containsAny(text, /\bque\s+mas\s+(?:podria|puedo)\s+vender\b/u)
    || containsAny(text, /\b(?:ampliar|mejorar)\s+(?:mi\s+)?(?:oferta|surtido|catalogo)\b/u)
    || (containsAny(text, /\b(?:producto|productos|servicio|servicios)\b/u)
      && containsAny(text, /\b(?:atraer|conseguir)\s+(?:mas\s+)?(?:clientela|clientes)\b/u))
    || containsAny(text, /\b(?:surtido|catalogo)\b/u)
    || (containsAny(text, /\b(?:producto|productos|articulo|articulos)\b/u)
      && containsAny(text, /\b(?:casi no vendo|casi no se venden|poco movimiento|sin movimiento|no estoy vendiendo|no vendo|dejaron de venderse|dejo de venderse|perdiendo movimiento|antes de agregar|antes de incorporar)\b/u))
    || (containsAny(text, /\b(?:categorias?)\b/u)
      && containsAny(text, /\b(?:venden mas|mas oportunidad|oportunidad|perdiendo fuerza|estan cayendo|estan creciendo|crecimiento|concentrad)\w*\b/u))
    || containsAny(text, /\b(?:productos?)\s+(?:del|de mi)\s+catalogo\b/u)
    || containsAny(text, /\b(?:donde|como)\s+(?:tengo\s+)?oportunidades?\s+(?:en|para ampliar)\s+(?:mi\s+)?(?:catalogo|surtido)\b/u)) {
    return supported('assortment_analysis', optionValues);
  }

  if (containsAny(text, /\b(?:ticket promedio|ticket medio|subir el ticket|aumentar el ticket|subir mi ticket|aumentar mi ticket|aumentar cada venta|cada venta sea mayor)\b/u)
    || (containsAny(text, /\b(?:ticket|valor promedio de cada venta)\b/u)
      && containsAny(text, /\b(?:como esta|esta subiendo|esta bajando|creciendo|subir|aumentar|incrementar|elevar|mayor|promedio)\b/u))) {
    return supported('ticket_growth', optionValues);
  }

  if (containsAny(text, /\b(?:que|cuales?)\s+(?:productos?|articulos?)\b/u)
    && containsAny(text, /\b(?:impulsar|promover|estan creciendo|crecen|crecimiento|perdiendo fuerza|bajando|aportan mas|aportan|funcionando mejor|mejor desempeño|vender mas|oportunidad(?:es)? de crecer|revisar para vender mas)\b/u)) {
    return supported('product_opportunity', optionValues);
  }

  if ((containsAny(text, /\b(?:ventas?)\b/u)
      && containsAny(text, /\b(?:estan creciendo|estan bajando|estan cayendo|crecen|creciendo|tendencia|cambiaron|han cambiado|cambio|variacion|subiendo|bajando|vendiendo mas que antes|vendiendo menos que antes)\b/u))
    || containsAny(text, /\b(?:estoy vendiendo mas que antes|estoy vendiendo menos que antes)\b/u)) {
    return supported('sales_trend', optionValues);
  }

  if (containsAny(text, /\b(?:como puedo aumentar mis ventas|como puedo vender mas|vender mas|aumentar (?:mis )?ventas|incrementar (?:mis )?ventas|hacer crecer mi negocio|hago crecer mi negocio|hacer crecer el negocio|crecer mi negocio|oportunidades? de crecimiento|oportunidades? para vender mas|ventas bajas?|mis ventas estan bajas|que puedo revisar para vender mas|mejorar mis ventas|impulsar mis ventas|recuperar mis ventas|atraer mas clientes|conseguir mas clientes)\b/u)) {
    return supported('sales_growth', optionValues);
  }

  if (containsAny(text, /\b(?:combo|combos|juntos|juntas|combinacion|combinaciones|compran juntos|tickets compartidos)\b/u)) {
    return supported('combo_opportunity', optionValues);
  }

  if (containsAny(text, /\b(?:promocion|promociones|descuento|descuentos|oferta|ofertas|rebaja|rebajas)\b/u)) {
    return supported('promotion_opportunity', optionValues);
  }

  const priceIntent = containsAny(text, /\b(?:subir|subo|sube|aumentar|aumento|aumenta|incrementar|incremento|incrementa|ajustar|ajusto|ajusta|modificar|modifico|modifica|cambiar|cambio|cambia|simular|simulacion|probar|evaluar)\b.*\bprecios?\b/u)
    || containsAny(text, /\b(?:que pasa si|que sucederia si)\s+(?:subo|aumento|incremento|ajusto|cambio)\b.*\bprecios?\b/u)
    || containsAny(text, /\bsimul(?:a|ar|acion)\s+(?:un\s+)?(?:nuevo\s+)?precio\b/u);
  if (priceIntent) return supported('price_simulation', optionValues);

  if (containsAny(text, /\b(?:productos?|articulos?)\b/u)
    && containsAny(text, /\b(?:malos?|problematic|problema|problemas|afectando|afectan|riesgo|riesgos|bajo margen|margen bajo|margen negativo|baja rentabilidad|menos rentable|peor margen|perdida|merma|mermas)\w*\b/u)) {
    return supported('product_risk', optionValues);
  }

  if (containsAny(text, /\b(?:por que|porque|explica|explicame|cambio|cambiaron|variacion|comparar|comparacion|comparado|subio|bajo|disminuyo|aumento|cayo)\b/u)
    && containsAny(text, /\b(?:margen|utilidad|ganancia|rentabilidad|ventas|costo|costos|ingresos)\b/u)) {
    return supported('explain_change', optionValues);
  }

  if (containsAny(text, /\b(?:rentable|rentabilidad|utilidad|utilidades|ganancia|ganancias|margen|margenes|perdida|perdidas)\b/u)
    || containsAny(text, /\b(?:como van|como fueron|como estuvo|como estuvieron|como esta|como estan|analiza|analizar|revisa|revisar|resumen|resultado|cuanto vendi|cuanto se vendio)\b.*\b(?:mis\s+)?ventas?\b/u)
    || containsAny(text, /\b(?:mis\s+)?ventas?\s+(?:del periodo|de este periodo|en el periodo)\b/u)) {
    return supported('profitability_summary', optionValues);
  }

  if (containsAny(text, /\b(?:negocio|ventas?|precio|precios|clientes?|clientela|producto|productos|servicio|servicios|rentabilidad|margen|utilidad|ganancia|costo|ingresos)\b/u)) {
    return resolution('needs_context', {
      topic: 'commercial_question',
      confidence: 'low',
      requiresData: false,
      requiresProvider: false,
      missingContext: ['objective']
    });
  }

  return resolution('out_of_scope', { reason: 'unrelated', topic: 'unrelated' });
};

export const getCommercialResolutionMessage = (value = {}) => {
  const kind = value.kind;
  const topic = value.topic;

  if (kind === 'identity') return createLiaIdentityAnswer(topic);

  if (kind === 'recognized_not_supported' && topic === 'competition') {
    return 'Entiendo que quieres analizar a tu competencia. Lanzo todavía no dispone de información externa suficiente sobre tus competidores para hacer una comparación confiable. Por ahora puedo ayudarte a analizar el desempeño interno de tu negocio con los datos disponibles.';
  }

  if (kind === 'recognized_not_supported' && topic === 'assortment') {
    return 'Entiendo que buscas ampliar tu oferta con nuevos productos o servicios para atraer más clientela. Esa evaluación todavía no está disponible con suficiente evidencia; Lanzo trabaja por ahora con la información de los productos y ventas que ya existen en tu negocio, así que no voy a sustituirla por un análisis diferente.';
  }

  if (kind === 'needs_context' && value.intent === 'price_simulation') {
    return 'Para simular el cambio, selecciona un producto y captura el nuevo precio. Lía analizará el escenario cuando ambos datos estén completos.';
  }

  if (kind === 'needs_context') {
    return 'Para orientarte bien, dime qué quieres revisar: rentabilidad, un cambio de margen, productos que afectan la utilidad, una simulación de precio, combos o promociones.';
  }

  if (kind === 'out_of_scope' && value.reason === 'module') {
    return 'Soy ' + LIA_IDENTITY.name + ', ' + LIA_IDENTITY.role + '. Esa consulta corresponde a otro módulo de Lanzo. En este espacio puedo ayudarte con ventas y rentabilidad.';
  }

  if (kind === 'out_of_scope' && value.reason === 'greeting') {
    return 'Soy ' + LIA_IDENTITY.name + ', ' + LIA_IDENTITY.role + '. Puedo ayudarte a entender ventas, rentabilidad y escenarios comerciales respaldados por los datos disponibles.';
  }

  return 'Soy ' + LIA_IDENTITY.name + ', ' + LIA_IDENTITY.role + '. Esa pregunta queda fuera de mi función, pero puedo ayudarte a entender ventas, rentabilidad y escenarios comerciales de tu negocio.';
};

export default resolveCommercialIntent;
