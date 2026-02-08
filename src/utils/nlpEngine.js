// src/utils/nlpEngine.js
/**
 * MOTOR DE PROCESAMIENTO DE LENGUAJE NATURAL (NLP)
 * Sistema avanzado para entender consultas del usuario en español
 */

// ============================================================
// 1. NORMALIZACIÓN Y PREPROCESAMIENTO DE TEXTO
// ============================================================

/**
 * Normaliza el texto del usuario para facilitar el análisis
 */
export const normalizeText = (text) => {
    if (!text || typeof text !== 'string') return '';

    return text
        .toLowerCase()
        .trim()
        // Eliminar acentos
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        // Eliminar caracteres especiales excepto números y espacios
        .replace(/[^\w\s]/g, ' ')
        // Normalizar espacios múltiples
        .replace(/\s+/g, ' ');
};

/**
 * Tokeniza el texto en palabras individuales
 */
export const tokenize = (text) => {
    return normalizeText(text).split(' ').filter(Boolean);
};

/**
 * Elimina palabras comunes que no aportan significado (stop words)
 */
const STOP_WORDS = new Set([
    'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas',
    'de', 'del', 'al', 'a', 'en', 'con', 'por', 'para',
    'y', 'o', 'pero', 'si', 'no', 'que', 'como', 'es', 'son',
    'mi', 'tu', 'su', 'me', 'te', 'se', 'le',
    'este', 'esta', 'estos', 'estas', 'ese', 'esa', 'esos', 'esas'
]);

export const removeStopWords = (tokens) => {
    return tokens.filter(token => !STOP_WORDS.has(token) && token.length > 2);
};

/**
 * NUEVA: Verifica si un token se parece a una palabra clave (Fuzzy Match)
 * Permite que "benta" coincida con "venta" o "prodcto" con "producto"
 */
export const isFuzzyMatch = (token, keyword, threshold = 0.75) => {
    // 1. Si son idénticos, retorna true directo
    if (token === keyword) return true;

    // 2. Si uno contiene al otro (ej: "ventas" contiene "venta")
    if (token.includes(keyword) || keyword.includes(token)) return true;

    // 3. Si no, usa similitud matemática (Levenshtein ya lo tienes implementado)
    const similarity = calculateSimilarity(token, keyword);
    return similarity >= threshold;
};

// ============================================================
// 2. EXTRACCIÓN DE ENTIDADES
// ============================================================

/**
 * Extrae números del texto (cantidades, precios, etc.)
 */
export const extractNumbers = (text) => {
    const numbers = [];
    const regex = /(\d+(?:[.,]\d+)?)/g;
    let match;

    while ((match = regex.exec(text)) !== null) {
        numbers.push(parseFloat(match[1].replace(',', '.')));
    }

    return numbers;
};

/**
 * Detecta períodos de tiempo en el texto
 */
export const extractTimeframe = (text) => {
    const normalized = normalizeText(text);

    const patterns = {
        today: /\b(hoy|dia|actual)\b/,
        yesterday: /\b(ayer|dia anterior)\b/,
        week: /\b(semana|semanal|ultimos 7 dias|ultima semana)\b/,
        month: /\b(mes|mensual|ultimos 30 dias|ultimo mes)\b/,
        year: /\b(ano|anual|ultimos 12 meses)\b/,
        custom: /ultimos? (\d+) dias?/
    };

    for (const [key, pattern] of Object.entries(patterns)) {
        if (pattern.test(normalized)) {
            if (key === 'custom') {
                const match = normalized.match(pattern);
                return { type: 'custom', days: parseInt(match[1]) };
            }
            return { type: key };
        }
    }

    return { type: 'today' }; // Por defecto
};

/**
 * Extrae nombres de productos mencionados en el texto
 */
export const extractNames = (text) => {
    // Busca texto entre comillas
    const quotedMatches = text.match(/"([^"]+)"/g);
    if (quotedMatches) {
        return quotedMatches.map(m => m.replace(/"/g, ''));
    }

    // Busca palabras capitalizadas consecutivas
    const capitalizedMatches = text.match(/([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+)*)/g);
    if (capitalizedMatches) {
        return capitalizedMatches;
    }

    return [];
};

// ============================================================
// 3. ANÁLISIS DE SIMILITUD
// ============================================================

/**
 * Calcula la distancia de Levenshtein entre dos strings
 */
export const calculateSimilarity = (str1, str2) => {
    const s1 = normalizeText(str1);
    const s2 = normalizeText(str2);

    if (s1 === s2) return 1;
    if (s1.length === 0 || s2.length === 0) return 0;

    const matrix = Array(s2.length + 1).fill(null)
        .map(() => Array(s1.length + 1).fill(null));

    for (let i = 0; i <= s1.length; i++) matrix[0][i] = i;
    for (let j = 0; j <= s2.length; j++) matrix[j][0] = j;

    for (let j = 1; j <= s2.length; j++) {
        for (let i = 1; i <= s1.length; i++) {
            const substitutionCost = s1[i - 1] === s2[j - 1] ? 0 : 1;
            matrix[j][i] = Math.min(
                matrix[j][i - 1] + 1,
                matrix[j - 1][i] + 1,
                matrix[j - 1][i - 1] + substitutionCost
            );
        }
    }

    const maxLength = Math.max(s1.length, s2.length);
    return 1 - (matrix[s2.length][s1.length] / maxLength);
};

/**
 * Encuentra el elemento más similar de una lista
 */
export const findMostSimilar = (input, items, threshold = 0.5) => {
    if (!items || items.length === 0) return null;

    const similarities = items.map(item => ({
        item,
        score: calculateSimilarity(input, typeof item === 'string' ? item : item.name)
    }));

    similarities.sort((a, b) => b.score - a.score);

    return similarities[0].score >= threshold ? similarities[0].item : null;
};

// ============================================================
// 4. CORRECCIÓN ORTOGRÁFICA
// ============================================================

/**
 * Diccionario de correcciones comunes
 */
const TYPO_CORRECTIONS = {
    'cuanto': 'cuanto',
    'bendi': 'vendi',
    'bender': 'vender',
    'ganancia': 'ganancia',
    'utilidad': 'utilidad',
    'caduca': 'caduca',
    'vence': 'vence',
    'kiero': 'quiero',
    'q': 'que',
    'benta': 'venta',
    'aser': 'hacer',
    'ocupo': 'necesito',
    'hai': 'hay'
};

/**
 * Corrige errores ortográficos comunes
 */
export const correctTypos = (text) => {
    let corrected = text;

    for (const [typo, correct] of Object.entries(TYPO_CORRECTIONS)) {
        const regex = new RegExp(`\\b${typo}\\b`, 'gi');
        corrected = corrected.replace(regex, correct);
    }

    return corrected;
};

// ============================================================
// 5. ANÁLISIS DE SENTIMIENTO
// ============================================================

/**
 * Detecta el sentimiento del mensaje
 */
export const analyzeSentiment = (text) => {
    const normalized = normalizeText(text);

    const positiveWords = ['bien', 'bueno', 'excelente', 'gracias', 'perfecto', 'genial'];
    const negativeWords = ['mal', 'error', 'problema', 'fallo', 'ayuda'];
    const questionWords = ['como', 'que', 'cuando', 'donde', 'quien', 'cuanto'];

    let positiveScore = 0;
    let negativeScore = 0;
    let questionScore = 0;

    positiveWords.forEach(word => {
        if (normalized.includes(word)) positiveScore++;
    });

    negativeWords.forEach(word => {
        if (normalized.includes(word)) negativeScore++;
    });

    questionWords.forEach(word => {
        if (normalized.includes(word)) questionScore++;
    });

    if (questionScore > 0) return 'question';
    if (negativeScore > positiveScore) return 'negative';
    if (positiveScore > negativeScore) return 'positive';
    return 'neutral';
};

// ============================================================
// 6. MEMORIA CONVERSACIONAL
// ============================================================

class ConversationMemory {
    constructor(maxHistory = 5) {
        this.history = [];
        this.maxHistory = maxHistory;
        this.context = {};
    }

    addMessage(userMessage, botResponse) {
        this.history.push({
            user: userMessage,
            bot: botResponse,
            timestamp: Date.now()
        });

        if (this.history.length > this.maxHistory) {
            this.history.shift();
        }
    }

    getLastMessage() {
        return this.history[this.history.length - 1];
    }

    clear() {
        this.history = [];
        this.context = {};
    }
}

export const conversationMemory = new ConversationMemory();