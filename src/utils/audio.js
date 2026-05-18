// src/utils/audio.js
/**
 * @deprecated Este archivo se mantiene para compatibilidad hacia atrás.
 * Usa src/services/audioBeep.js para nuevas implementaciones.
 *
 * Re-exporta las funciones del servicio de audio singleton.
 * Esto asegura que todo el código existente siga funcionando
 * mientras se migra al nuevo servicio.
 */

export {
    playBeep,
    playErrorBeep,
    playSuccessBeep,
    playBulkProductBeep,
    playScanBeep,
    disposeAudioContext
} from '../services/audioBeep';
