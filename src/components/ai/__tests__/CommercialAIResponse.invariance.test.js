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

  it('locks the reviewed report components and historical adapter byte for byte', () => {
    const page = source('CommercialAIAgentsPage.jsx');
    const protectedReport = page.slice(page.indexOf('function Metric('), page.indexOf('function HistoryPanel('));
    // Etapa 2 adds record reconciliation and data-quality confidence evidence
    // to the report; keep the reviewed rendering and historical adapter locked.
    expect(hash(protectedReport)).toBe('3e5e80c7ae911171f8778479c2a3c882970020344b96f45c2ddc0930990f0970');
  });

  it('locks report styles including the new coverage disclosure layout', () => {
    expect(hash(source('CommercialAIAgentsPage.css'))).toBe('df7550fca395475a2e07c471b448ead383943564d5be7c45a3cd437f0ace0125');
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
