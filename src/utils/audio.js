// src/utils/audio.js

/**
 * Reproduce un beep de audio usando Web Audio API.
 * Útil para feedback auditivo en escaneos de código de barras u otras acciones.
 * 
 * @param {number} freq - Frecuencia en Hz (default: 1200)
 * @param {string} type - Tipo de onda: 'sine' | 'square' | 'sawtooth' | 'triangle' (default: 'sine')
 * @returns {void}
 */
export function playBeep(freq = 1200, type = 'sine') {
    try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) return;

        const ctx = new AudioContext();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = type;
        osc.frequency.setValueAtTime(freq, ctx.currentTime);

        gain.gain.setValueAtTime(0.1, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.00001, ctx.currentTime + 0.1);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start();
        osc.stop(ctx.currentTime + 0.1);
    } catch (e) {
        console.warn('Audio no disponible', e);
    }
}

/**
 * Reproduce una secuencia de beeps para feedback de error.
 * @returns {void}
 */
export function playErrorBeep() {
    playBeep(200, 'sawtooth');
}

/**
 * Reproduce una secuencia de beeps para feedback de éxito.
 * @returns {void}
 */
export function playSuccessBeep() {
    playBeep(1000, 'sine');
    setTimeout(() => playBeep(1200, 'sine'), 100);
}

/**
 * Reproduce un beep para productos a granel (secuencia especial).
 * @returns {void}
 */
export function playBulkProductBeep() {
    playBeep(1000, 'sine');
    setTimeout(() => playBeep(500, 'square'), 150);
}
