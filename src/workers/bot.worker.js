import { BOT_COMPUTATIONS } from './botProtocol';
import { getInventoryOperationalState, INVENTORY_OPERATIONAL_TYPES } from '../services/inventoryOperationalAlerts';
import { createFinancialSalesAccumulator } from '../services/sales/financialPolicy';
import { accumulateProductStats } from '../services/reports/productStats';
import { processBotMessage } from '../utils/botIntelligence';
import { getBotScreen } from '../config/botKnowledge';

let computation = null;
self.onmessage = async ({ data }) => {
  const { id, type, payload } = data || {};
  if (!id) return;
  try {
    if (type === 'CONTEXT') {
      const screen = getBotScreen(payload.pathname, payload.search, payload.tab);
      self.postMessage({ id, type: 'RESULT', value: { label: screen.label, guides: screen.guides.slice(0, 3).map(({ id, question }) => ({ id, question })) } });
    } else if (type === 'QUESTION') {
      const value = await processBotMessage(payload.text, payload.context);
      self.postMessage(value.kind === 'read' ? { id, type: 'READ', intent: value.intent, timeframe: value.timeframe } : { id, type: 'RESULT', value });
    } else if (type === 'COMPUTE_START' && BOT_COMPUTATIONS.includes(payload.operation)) {
      computation = { operation: payload.operation, accumulator: payload.operation === 'financial' ? createFinancialSalesAccumulator() : payload.operation === 'stock' ? [] : new Map(), incomplete: false };
      self.postMessage({ id, type: 'RESULT', value: true });
    } else if (type === 'COMPUTE_CHUNK' && computation && Array.isArray(payload.sales)) {
      if (computation.operation === 'financial') {
        computation.accumulator.add(payload.sales);
        computation.incomplete ||= payload.sales.some(sale => !sale.items?.length);
      } else if (computation.operation === 'stock') {
        for (const product of payload.sales) {
          const stock = getInventoryOperationalState({ product }).stock;
          if ([INVENTORY_OPERATIONAL_TYPES.LOW_STOCK, INVENTORY_OPERATIONAL_TYPES.OUT_OF_STOCK].includes(stock.type)) {
            computation.accumulator.push({ name: product.name || product.productName, currentStock: stock.availableStock, urgency: stock.minStock > 0 ? stock.availableStock / stock.minStock : stock.availableStock <= 0 ? 0 : 1 });
          }
        }
        computation.accumulator.sort((a, b) => a.urgency - b.urgency);
        computation.accumulator.length = Math.min(5, computation.accumulator.length);
      } else accumulateProductStats(payload.sales, computation.accumulator);
      self.postMessage({ id, type: 'RESULT', value: true });
    } else if (type === 'COMPUTE_END' && computation) {
      const value = computation.operation === 'financial'
        ? { ...computation.accumulator.result(), hasIncompleteItems: computation.incomplete }
        : computation.operation === 'stock' ? computation.accumulator : [...computation.accumulator.values()].sort((a, b) => b.quantity - a.quantity).slice(0, 5);
      computation = null;
      self.postMessage({ id, type: 'RESULT', value });
    } else {
      throw new Error('BOT_INVALID_MESSAGE');
    }
  } catch {
    computation = null;
    self.postMessage({ id, type: 'ERROR', code: 'BOT_PROCESSING_FAILED' });
  }
};
