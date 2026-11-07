import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = (name) => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const hash = (value) => createHash('sha256').update(value).digest('hex');

// Recorded from main b6843578409b62e7efce941aa4b819d304d9d661 before edits.
// These are source integrity contracts, not regenerated render snapshots.
describe('approved response and Free boundaries', () => {
  it('preserves all ten suggestion labels, intents and the four period options', () => {
    const page = source('CommercialAIAgentsPage.jsx');
    expect(hash(page.slice(page.indexOf('const SUGGESTED_QUESTIONS'), page.indexOf('const EMPTY_ARRAY')))).toBe('6c60f9f98cf4569fae0ace17b8027fbac23eebbd9012d5f91206c6966baf2261');
  });

  it('preserves every report component and the historical adapter byte for byte', () => {
    const page = source('CommercialAIAgentsPage.jsx');
    const protectedReport = page.slice(page.indexOf('function Metric('), page.indexOf('function HistoryPanel('));
    expect(hash(protectedReport)).toBe('cca23f163a0492d3f32838ba709734b63306bc42df6a27a16f1c8c55b208663a');
  });

  it('preserves the entire original stylesheet including tables, metrics and report breakpoints', () => {
    expect(hash(source('CommercialAIAgentsPage.css'))).toBe('7d3955b30d2ae9262d7aada0ac7d656382a82a78ab3f2169f802b64dcb8cd632');
  });

  it('preserves the Free showcase while requiring the current authenticated actor', () => {
    const route = source('CommercialAIAgentsRoute.jsx');
    expect(route).toContain('useActorAccess');
    expect(route).toContain('const { runtimeSnapshot: actorSnapshot } = useActorAccess()');
    expect(route).toContain('getCommercialAIAgentAccessState({ licenseDetails, actorSnapshot })');
    expect(route).toContain('if (!access.canSeeEntry) return <NoPermission />');
    expect(route).toContain('if (!access.canEnter)');
    expect(route).toContain('<ProFeatureShowcase');
    expect(route).toContain('return children;');
  });

  it('keeps new workspace rules away from protected report selectors', () => {
    expect(source('CommercialAIWorkspace.css')).not.toMatch(/\.commercial-ai-(?:result|metric|table|executive|section|confidence|narrative|technical|recommendation)\b/);
  });
});
