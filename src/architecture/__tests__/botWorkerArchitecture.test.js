// @vitest-environment node
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
const root = fileURLToPath(new URL('../../../', import.meta.url));
async function visit(file, seen = new Set()) {
  if (seen.has(file)) return seen;
  seen.add(file);
  const source = await readFile(path.join(root, file), 'utf8');
  for (const match of source.matchAll(/(?:from\s*|import\s*\()["']([^"']+)["']/g)) {
    const target = match[1];
    if (!target.startsWith('.')) { expect(target).toBe('big.js'); continue; }
    await visit(path.normalize(path.join(path.dirname(file), target.endsWith('.js') ? target : target + '.js')), seen);
  }
  return seen;
}
describe('Bot process boundary', () => {
  it('keeps database, credentials, React and tenant authority out of the worker graph', async () => {
    const files = [...await visit('src/workers/bot.worker.js')];
    expect(files.join('\n')).not.toMatch(/services\/db\/|tenantRuntime|auth\/|botReadService|supabase|store\/|hooks\/|react/i);
    expect(files).toContain('src/utils/botIntelligence.js');
    expect(files).toContain('src/services/sales/financialPolicy.js');
  });
  it('keeps the operational engine and knowledge out of React and its transport', async () => {
    for (const file of ['src/hooks/useBotAssistant.js', 'src/services/botWorkerClient.js', 'src/components/common/AssistantBot.jsx']) {
      const source = await readFile(path.join(root, file), 'utf8');
      expect(source).not.toMatch(/from ['"].*(?:botIntelligence|botKnowledge)|detectIntent\(|summarizeFinancialSales\(/);
    }
  });
});
