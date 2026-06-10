import { describe, expect, it } from 'vitest';
import { collectBatchRestorations, restoreBatchStock } from '../../sales/batchRestoration';

describe('batchRestoration', () => {
  it('conserva el costo actual y valora la restauracion con batchUsage.cost', () => {
    const restorations = collectBatchRestorations([{
      batchesUsed: [{
        batchId: 'batch-1',
        quantity: 3,
        cost: 10
      }]
    }]);

    const result = restoreBatchStock({
      batch: {
        id: 'batch-1',
        stock: 2,
        cost: 15,
        isActive: true
      },
      restoration: restorations.get('batch-1'),
      normalizeStock: Number,
      updatedAt: '2026-06-08T00:00:00.000Z'
    });

    expect(result.updatedBatch.stock).toBe(5);
    expect(result.updatedBatch.cost).toBe(15);
    expect(result.restorationValue).toBe(30);
  });

  it('usa el costo actual solo para usos legacy sin costo historico', () => {
    const restorations = collectBatchRestorations([{
      batchesUsed: [
        { batchId: 'batch-1', quantity: 2, cost: 10 },
        { batchId: 'batch-1', quantity: 1 }
      ]
    }]);

    const result = restoreBatchStock({
      batch: { id: 'batch-1', stock: 0, cost: 15, isActive: false },
      restoration: restorations.get('batch-1'),
      normalizeStock: Number,
      updatedAt: '2026-06-08T00:00:00.000Z'
    });

    expect(result.updatedBatch.cost).toBe(15);
    expect(result.restorationValue).toBe(35);
  });
});
