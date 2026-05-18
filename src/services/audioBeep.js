// src/services/audioBeep.js
/**
 * Servicio Singleton para efectos de sonido usando Web Audio API.
 * Resuelve fugas de memoria al no crear un nuevo AudioContext en cada escaneo.
 * Inicialización perezosa (lazy) - solo crea el contexto cuando se necesita.
 */

let audioContext = null;

/**
 * Obtiene o crea el AudioContext singleton.
 * @returns {AudioContext|null}
 */
const getAudioContext = () => {
  if (audioContext) return audioContext;

  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return null;

  audioContext = new AudioContextClass();
  return audioContext;
};

/**
 * Reanuda el AudioContext si está suspendido (políticas del navegador).
 * @returns {Promise<boolean>}
 */
const resumeContext = async () => {
  const ctx = getAudioContext();
  if (!ctx) return false;

  if (ctx.state === 'suspended') {
    try {
      await ctx.resume();
    } catch (e) {
      console.warn('No se pudo reanudar AudioContext:', e);
      return false;
    }
  }
  return true;
};

/**
 * Reproduce un beep de audio.
 * @param {number} freq - Frecuencia en Hz (default: 1200)
 * @param {string} type - Tipo de onda: 'sine' | 'square' | 'sawtooth' | 'triangle' (default: 'sine')
 * @param {number} duration - Duración en segundos (default: 0.1)
 * @param {number} volume - Volumen 0-1 (default: 0.1)
 * @returns {Promise<void>}
 */
export const playBeep = async (freq = 1200, type = 'sine', duration = 0.1, volume = 0.1) => {
  const ctx = getAudioContext();
  if (!ctx) return;

  await resumeContext();

  try {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);

    gain.gain.setValueAtTime(volume, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.00001, ctx.currentTime + duration);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    osc.stop(ctx.currentTime + duration);
  } catch (e) {
    console.warn('Error reproduciendo beep:', e);
  }
};

/**
 * Reproduce una secuencia de beeps para feedback de error.
 * @returns {Promise<void>}
 */
export const playErrorBeep = async () => {
  await playBeep(200, 'sawtooth', 0.15, 0.15);
};

/**
 * Reproduce una secuencia de beeps para feedback de éxito.
 * @returns {Promise<void>}
 */
export const playSuccessBeep = async () => {
  await playBeep(1000, 'sine', 0.08, 0.1);
  setTimeout(() => playBeep(1200, 'sine', 0.08, 0.1), 100);
};

/**
 * Reproduce un beep para productos a granel (secuencia especial).
 * @returns {Promise<void>}
 */
export const playBulkProductBeep = async () => {
  await playBeep(1000, 'sine', 0.08, 0.1);
  setTimeout(() => playBeep(500, 'square', 0.1, 0.1), 150);
};

/**
 * Reproduce un beep corto para escaneo rápido.
 * @returns {Promise<void>}
 */
export const playScanBeep = async () => {
  await playBeep(1000, 'sine', 0.05, 0.1);
};

/**
 * Libera el AudioContext (útil para pruebas o cleanup).
 */
export const disposeAudioContext = () => {
  if (audioContext) {
    audioContext.close().catch(() => {});
    audioContext = null;
  }
};
