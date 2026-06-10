import { describe, expect, it, vi } from 'vitest';
import { runChunkedMigration } from '../migrationCore';

describe('runChunkedMigration', () => {
  it('no bloquea el event loop durante la migracion de 5000 productos', async () => {
    const products = Array.from({ length: 5000 }, (_, index) => ({
      id: `prod-${index}`,
      stock: index % 2 === 0 ? 10 : 0,
      isActive: true
    }));

    let timerTicks = 0;
    const checkInterval = setInterval(() => {
      timerTicks++;
    }, 5);
    const start = performance.now();

    const result = await runChunkedMigration({
      chunkSize: 500,
      delayBetweenChunks: 10,
      processChunk: async (offset, limit) => {
        const batch = products.slice(offset, offset + limit);

        for (const product of batch) {
          product.activeStockStatus =
            product.isActive !== false && Number(product.stock) > 0 ? 1 : 0;
        }

        return {
          processed: batch.length,
          scanned: batch.length,
          hasMore: offset + batch.length < products.length
        };
      }
    });

    clearInterval(checkInterval);
    const duration = performance.now() - start;

    expect(result.processed).toBe(5000);
    expect(timerTicks).toBeGreaterThan(0);
    expect(duration).toBeGreaterThanOrEqual(50);
  });

  it('avanza aunque un chunk no requiera actualizaciones', async () => {
    const processChunk = vi.fn()
      .mockResolvedValueOnce({ processed: 0, scanned: 500, hasMore: true })
      .mockResolvedValueOnce({ processed: 2, scanned: 2, hasMore: false });

    const result = await runChunkedMigration({
      processChunk,
      chunkSize: 500,
      delayBetweenChunks: 0
    });

    expect(processChunk).toHaveBeenNthCalledWith(1, 0, 500);
    expect(processChunk).toHaveBeenNthCalledWith(2, 500, 500);
    expect(result).toMatchObject({ processed: 2, offset: 502 });
  });
});
