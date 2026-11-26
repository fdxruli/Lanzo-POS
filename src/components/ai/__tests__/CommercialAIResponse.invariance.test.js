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
    // LIA-02 (#597) and Etapa 1: verified additions are limited to contextual
    // recommendation review actions and their history callback wiring. The
    // deterministic report calculations and evidence selectors are unchanged.
    expect(hash(protectedReport)).toBe('ef589584936f144a11d31a6e988a337769322269dc76f4655d9d900462c5996b');
  });

  it('preserves the entire original stylesheet including tables, metrics and report breakpoints', () => {
    // Etapa 1 appends the contextual review button styles and its mobile layout;
    // the pre-existing report styles are unchanged in the reviewed diff.
    expect(hash(source('CommercialAIAgentsPage.css'))).toBe('f0dce8cf04cf5f8a4536c44231236d208fcd23d2d0656b6e36620ab5ce82cf70');
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
