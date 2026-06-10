export const collectBatchRestorations = (items = []) => {
  const restorations = new Map();

  for (const item of items) {
    if (!Array.isArray(item?.batchesUsed)) continue;

    for (const batchUsage of item.batchesUsed) {
      if (!batchUsage?.batchId) continue;

      const quantity = Number(batchUsage.quantity || 0);
      const hasHistoricalCost = batchUsage.cost !== null &&
        batchUsage.cost !== undefined &&
        batchUsage.cost !== '';
      const historicalCost = Number(batchUsage.cost);
      const current = restorations.get(batchUsage.batchId) || {
        quantity: 0,
        historicalValue: 0,
        quantityWithoutHistoricalCost: 0
      };

      current.quantity += quantity;
      if (hasHistoricalCost && Number.isFinite(historicalCost)) {
        current.historicalValue += quantity * historicalCost;
      } else {
        current.quantityWithoutHistoricalCost += quantity;
      }

      restorations.set(batchUsage.batchId, current);
    }
  }

  return restorations;
};

export const restoreBatchStock = ({ batch, restoration, normalizeStock, updatedAt }) => {
  const currentCost = Number(batch.cost);
  const fallbackValue = Number.isFinite(currentCost)
    ? restoration.quantityWithoutHistoricalCost * currentCost
    : 0;
  const restorationValue = restoration.historicalValue + fallbackValue;
  const newStock = normalizeStock(Number(batch.stock || 0) + restoration.quantity);

  return {
    updatedBatch: {
      ...batch,
      stock: newStock,
      isActive: newStock > 0,
      updatedAt
    },
    restorationValue,
    newStock
  };
};
