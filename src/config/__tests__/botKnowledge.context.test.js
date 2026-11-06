import { describe, expect, it } from 'vitest';
import { BOT_SCREENS, getBotScreen } from '../botKnowledge';

describe('Lanzó Bot contextual metadata', () => {
  it('covers all eleven registered bot pages with a short description and navigation actions', () => {
    expect(Object.keys(BOT_SCREENS)).toHaveLength(11);
    for (const pathname of Object.keys(BOT_SCREENS)) {
      const screen = getBotScreen(pathname);
      expect(screen.description.length).toBeGreaterThan(15);
      expect(screen.actions.length).toBeGreaterThanOrEqual(2);
      expect(screen.actions.length).toBeLessThanOrEqual(5);
      expect(new Set(screen.actions.map(action => action.path)).size).toBe(screen.actions.length);
      expect(screen.actions.every(action => action.path.startsWith('/') && typeof action.label === 'string')).toBe(true);
    }
  });
  it('resolves a published inner tab from the existing guide without duplicating its instructions', () => {
    const screen = getBotScreen('/caja', '', 'movimientos');
    expect(screen.label).toBe('Caja · Movimientos');
    expect(screen.description).toMatch(/Entrada|Salida|Turno/i);
    expect(screen.guides[0].id).toBe('cash_movements');
  });
  it('adds a restaurant-specific, purely navigational shortcut when applicable', () => {
    const restaurant = getBotScreen('/', '', '', 'food_service');
    const retail = getBotScreen('/', '', '', 'abarrotes');
    expect(restaurant.description).toMatch(/mesa/i);
    expect(restaurant.actions.some(action => action.path === '/pedidos')).toBe(true);
    expect(retail.actions.some(action => action.path === '/pedidos')).toBe(false);
  });
});
