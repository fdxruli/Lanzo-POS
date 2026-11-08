import { describe, expect, it, vi } from 'vitest';
import { BOT_GUIDES, BOT_SCREENS, getBotScreen } from '../../config/botKnowledge';
import { detectIntent, processBotMessage } from '../botIntelligence';
import { extractTimeframe } from '../nlpEngine';
import { canOpenBotAction } from '../botNavigation';
const read = vi.hoisted(() => vi.fn().mockResolvedValue({ title: 'Consulta', message: 'Resultado' }));
vi.mock('../../services/botReadService', () => ({ readBotBusinessData: read }));

describe('Operational knowledge and intent recognition', () => {
  it.each(BOT_GUIDES.map(guide => [guide.question, guide.id]))('%s resolves to its operational guide', async (question, id) => {
    expect(detectIntent(question)).toBe(id);
    const answer = await processBotMessage(question, { pathname: '/' });
    expect(answer.message).toMatch(/^1\./);
    expect(canOpenBotAction(answer.actions[0].path, () => true)).toBe(true);
  });
  it.each([
    ['Cuánto vendí hoy', 'sales_report'], ['Ventas de la semana', 'sales_report'],
    ['Cuál fue mi ganancia esta semana', 'profit_report'], ['Cuánto gané ayer', 'profit_report'],
    ['Quién me debe dinero', 'customer_debt'], ['Qué productos se están agotando', 'low_stock'],
    ['Qué productos tienen stock bajo', 'low_stock'], ['Qué productos están por caducar', 'expiration_alert'],
    ['Qué se vende más este mes', 'top_products'], ['como hago una venta', 'sale'],
    ['quiero agregar un producto', 'product'], ['necesito registrar un abono', 'customer_payment'],
    ['como veo los pedidos online', 'online_orders'], ['el stock no cuadra', 'inventory_error']
  ])('%s → %s', (question, intent) => expect(detectIntent(question)).toBe(intent));
  it('handles an unknown question without inventing capabilities', async () => {
    expect((await processBotMessage('xyz123', { pathname: '/clientes', search: '?tab=add' })).options[0].query).toBe('¿Cómo registro un cliente?');
  });
  it('adapts a procedure to the business and Staff context', async () => {
    const response = await processBotMessage('¿Cómo hago una venta rápida?', { businessType: 'farmacia', actorType: 'staff' });
    expect(response.tips.join(' ')).toMatch(/caducidad/);
    expect(response.tips.join(' ')).toMatch(/administrador/);
  });
  it.each(Object.entries(BOT_SCREENS).flatMap(([path, screen]) => Object.entries(screen.tabs || {}).map(([tab, info]) => [path, tab, info[0]])))('%s tab %s has matching contextual suggestions', (path, tab, label) => {
    expect(getBotScreen(path, `?tab=${tab}`).label).toContain(label);
  });
  it('does not claim a date range it cannot parse', async () => {
    expect((await processBotMessage('Cuánto vendí en 2020')).title).toBe('Elige un período');
  });
});
describe('Calendar periods', () => {
  const now = new Date(2026, 10, 6, 14, 30);
  it.each([
    ['hoy', 6, 10], ['ayer', 5, 10], ['esta semana', 2, 10], ['semana pasada', 26, 9],
    ['este mes', 1, 10], ['mes pasado', 1, 9], ['últimos 7 días', 31, 9]
  ])('%s uses explicit local calendar boundaries', (text, day, month) => {
    const range = extractTimeframe(text, now);
    expect(range.start.getDate()).toBe(day); expect(range.start.getMonth()).toBe(month);
    expect(range.start.getHours()).toBe(0);
  });
});
describe('Navigation authority', () => {
  it('uses ecommerce permission and the actual inbox entitlement', () => {
    const context = { licenseDetails: { features: { ecommerce_order_inbox: true } }, actorSnapshot: { actorType: 'staff', permissions: ['ecommerce'] } };
    expect(canOpenBotAction('/pedidos-online', () => true, context)).toBe(true);
    context.actorSnapshot.permissions = ['orders'];
    expect(canOpenBotAction('/pedidos-online', () => true, context)).toBe(false);
    context.actorSnapshot.actorType = 'admin'; context.licenseDetails = {};
    expect(canOpenBotAction('/pedidos-online', () => true, context)).toBe(false);
  });

  it('rejects external, missing routes and unauthorized sections', () => {
    for (const path of ['//example.com', 'https://example.com', '/inventory', '/reports/sales']) expect(canOpenBotAction(path, () => true)).toBe(false);
    expect(canOpenBotAction('/ventas', permission => permission === 'pos')).toBe(false);
    expect(canOpenBotAction('/productos?tab=batches', permission => permission === 'products')).toBe(false);
    expect(canOpenBotAction('/configuracion?tab=backup', permission => permission === 'sync')).toBe(false);
    expect(canOpenBotAction('/configuracion?tab=backup', permission => permission === 'settings_backup')).toBe(true);
    expect(canOpenBotAction('/configuracion?tab=controls', permission => permission === 'settings_controls')).toBe(true);
  });
});
