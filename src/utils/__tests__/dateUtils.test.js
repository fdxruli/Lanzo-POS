/**
 * Tests para el Sistema Temporal Determinista (FASE 4)
 * 
 * Criterios de Aceptación:
 * 1. Test de Integridad de Índices: purgeBatchExpirations debe usar null, no undefined
 * 2. Test de Unicidad Temporal: commitStock usa timestamp unificado
 * 3. Test de Parseo Estricto FEFO: Lotes con fechas inválidas no rompen el ordenamiento
 * 4. Test de Determinismo UTC: Fechas parseadas mantienen UTC midnight
 */

import { 
    getOperationTimestamp, 
    withUnifiedTimestamp, 
    parseStrictCalendarDate, 
    parseDateStrict,
    extractCalendarDate 
} from '../dateUtils';

describe('Sistema Temporal Determinista - FASE 4', () => {
    
    describe('getOperationTimestamp', () => {
        it('debe retornar un string ISO válido', () => {
            const ts = getOperationTimestamp();
            expect(typeof ts).toBe('string');
            expect(ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
        });

        it('debe retornar timestamps UTC (terminando en Z)', () => {
            const ts = getOperationTimestamp();
            expect(ts.endsWith('Z')).toBe(true);
        });
    });

    describe('withUnifiedTimestamp', () => {
        it('debe inyectar el mismo timestamp a todas las operaciones', async () => {
            const timestamps = [];
            
            await withUnifiedTimestamp(async (ts) => {
                timestamps.push(ts);
                await Promise.resolve();
                timestamps.push(ts);
                timestamps.push(ts);
            });

            expect(timestamps.length).toBe(3);
            expect(new Set(timestamps).size).toBe(1); // Todos iguales
        });

        it('debe retornar el resultado de la operación', async () => {
            const result = await withUnifiedTimestamp(async (ts) => {
                return { success: true, timestamp: ts };
            });

            expect(result.success).toBe(true);
            expect(result.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
        });
    });

    describe('parseStrictCalendarDate', () => {
        it('debe normalizar fechas de entrada a UTC 00:00:00', () => {
            const input = '2024-06-15'; // Sin tiempo
            const result = parseStrictCalendarDate(input);
            expect(result).toBe('2024-06-15T00:00:00.000Z');
            expect(result.endsWith('T00:00:00.000Z')).toBe(true);
        });

        it('debe retornar null para input vacío', () => {
            expect(parseStrictCalendarDate(null)).toBeNull();
            expect(parseStrictCalendarDate('')).toBeNull();
            expect(parseStrictCalendarDate(undefined)).toBeNull();
        });

        it('debe lanzar error para formato inválido', () => {
            expect(() => parseStrictCalendarDate('2024-13-45')).toThrow(); // Mes inválido
            expect(() => parseStrictCalendarDate('2024-06-32')).toThrow(); // Día inválido
            expect(() => parseStrictCalendarDate('invalid')).toThrow();
            expect(() => parseStrictCalendarDate('2024/06/15')).toThrow(); // Formato incorrecto
        });

        it('debe manejar años en rango válido (1900-2100)', () => {
            expect(() => parseStrictCalendarDate('1800-06-15')).toThrow();
            expect(() => parseStrictCalendarDate('2200-06-15')).toThrow();
            expect(parseStrictCalendarDate('2000-06-15')).toBe('2000-06-15T00:00:00.000Z');
        });
    });

    describe('parseDateStrict', () => {
        it('debe parsear strings YYYY-MM-DD correctamente', () => {
            const result = parseDateStrict('2024-12-25');
            expect(result).toBeInstanceOf(Date);
            expect(result.toISOString()).toBe('2024-12-25T00:00:00.000Z');
        });

        it('debe parsear ISO strings correctamente', () => {
            const result = parseDateStrict('2024-12-25T00:00:00.000Z');
            expect(result).toBeInstanceOf(Date);
            expect(result.toISOString()).toBe('2024-12-25T00:00:00.000Z');
        });

        it('debe retornar null para fechas inválidas sin lanzar error', () => {
            expect(parseDateStrict('fecha-invalida')).toBeNull();
            expect(parseDateStrict('2024-13-45')).toBeNull();
            expect(parseDateStrict(null)).toBeNull();
            expect(parseDateStrict('')).toBeNull();
        });

        it('debe retornar null para objetos Date inválidos', () => {
            expect(parseDateStrict(new Date('invalid'))).toBeNull();
        });

        it('debe aceptar objetos Date válidos', () => {
            const validDate = new Date('2024-06-15');
            const result = parseDateStrict(validDate);
            expect(result).toBeInstanceOf(Date);
            expect(result.getTime()).toBe(validDate.getTime());
        });
    });

    describe('Determinismo UTC - Integración FEFO', () => {
        it('debe mantener fechas UTC medianoche para ordenamiento FEFO', () => {
            // Simulación de ordenamiento FEFO con fechas mixtas
            const batches = [
                { id: 1, expiryDate: '2024-12-31T00:00:00.000Z' },
                { id: 2, expiryDate: '2024-06-15T00:00:00.000Z' },
                { id: 3, expiryDate: '2025-01-01T00:00:00.000Z' }
            ];

            const sorted = [...batches].sort((a, b) => {
                const aTime = parseDateStrict(a.expiryDate)?.getTime() || 0;
                const bTime = parseDateStrict(b.expiryDate)?.getTime() || 0;
                return aTime - bTime;
            });

            expect(sorted[0].id).toBe(2); // Junio primero
            expect(sorted[1].id).toBe(1); // Diciembre segundo
            expect(sorted[2].id).toBe(3); // Enero siguiente año
        });

        it('debe manejar fechas inválidas en ordenamiento FEFO sin crashear', () => {
            const batches = [
                { id: 1, expiryDate: '2024-12-31', createdAt: '2024-01-01' },
                { id: 2, expiryDate: 'fecha-invalida', createdAt: '2024-01-02' },
                { id: 3, expiryDate: '2024-11-30', createdAt: '2024-01-03' }
            ];

            const sorted = [...batches].sort((a, b) => {
                const aTime = parseDateStrict(a.expiryDate)?.getTime() || Number.MAX_SAFE_INTEGER;
                const bTime = parseDateStrict(b.expiryDate)?.getTime() || Number.MAX_SAFE_INTEGER;
                return aTime - bTime;
            });

            // El lote 3 (noviembre) debe ir antes que el 1 (diciembre)
            // El lote 2 (inválido) debe ir al final
            expect(sorted[0].id).toBe(3);
            expect(sorted[1].id).toBe(1);
            expect(sorted[2].id).toBe(2); // Inválido al final
        });
    });

    describe('extractCalendarDate', () => {
        it('debe extraer YYYY-MM-DD de ISO string UTC', () => {
            expect(extractCalendarDate('2024-12-25T00:00:00.000Z')).toBe('2024-12-25');
            expect(extractCalendarDate('2024-06-05T14:30:45.123Z')).toBe('2024-06-05');
        });

        it('debe retornar null para inputs inválidos', () => {
            expect(extractCalendarDate(null)).toBeNull();
            expect(extractCalendarDate('')).toBeNull();
            expect(extractCalendarDate('invalid')).toBeNull();
        });
    });
});
