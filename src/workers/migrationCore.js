const waitForNextChunk = (delayMs) =>
  new Promise((resolve) => setTimeout(resolve, Math.max(0, delayMs)));

export const runChunkedMigration = async ({
  processChunk,
  chunkSize = 500,
  delayBetweenChunks = 10,
  onProgress = () => {},
  shouldStop = () => false,
  wait = waitForNextChunk
}) => {
  let offset = 0;
  let totalProcessed = 0;
  let hasMore = true;

  while (hasMore && !shouldStop()) {
    const result = await processChunk(offset, chunkSize);
    const scanned = Number(result.scanned ?? result.processed ?? 0);
    const processed = Number(result.processed ?? 0);

    if (result.hasMore && scanned <= 0) {
      throw new Error('La migracion no avanzo al procesar el chunk');
    }

    totalProcessed += processed;
    offset = result.nextOffset ?? (offset + scanned);
    hasMore = Boolean(result.hasMore);

    onProgress({
      processed: totalProcessed,
      currentBatch: processed,
      scanned,
      offset
    });

    if (hasMore && !shouldStop()) {
      await wait(delayBetweenChunks);
    }
  }

  return { processed: totalProcessed, offset, stopped: shouldStop() };
};
