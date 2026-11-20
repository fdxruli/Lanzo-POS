import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearProductFormDraft,
  createProductFormDraftScope,
  readProductFormDraft,
  saveProductFormDraft
} from '../productFormDraftCache';

const runtime = (overrides = {}) => ({
  status: 'granted',
  actorKey: 'admin:admin-1',
  sessionId: 'session-1',
  tenant: { opaqueId: 'tenant-1' },
  ...overrides
});

describe('product form draft scope', () => {
  const scope = createProductFormDraftScope(runtime());

  beforeEach(() => clearProductFormDraft(scope));

  it('restores a draft for the same actor session and tenant', () => {
    const draft = {
      activeTab: 'add-product',
      productToEdit: { id: 'soap-qa', name: 'Jabón QA' },
      values: { id: 'soap-qa', description: 'Descripción editada', categoryId: 'hygiene-qa' }
    };

    expect(saveProductFormDraft(scope, draft)).toBe(true);
    expect(readProductFormDraft(scope)).toEqual(draft);
  });

  it('does not carry a draft into a different tenant or session', () => {
    saveProductFormDraft(scope, { values: { description: 'No transferir' } });
    const otherTenant = createProductFormDraftScope(runtime({
      tenant: { opaqueId: 'tenant-2' }
    }));
    const otherSession = createProductFormDraftScope(runtime({ sessionId: 'session-2' }));

    expect(readProductFormDraft(otherTenant)).toBeNull();
    expect(readProductFormDraft(scope)).toBeNull();
    expect(readProductFormDraft(otherSession)).toBeNull();
  });

  it('requires a granted actor, session and tenant identity before creating a scope', () => {
    expect(createProductFormDraftScope(null)).toBeNull();
    expect(createProductFormDraftScope(runtime({ status: 'locked' }))).toBeNull();
    expect(createProductFormDraftScope(runtime({ sessionId: null }))).toBeNull();
    expect(createProductFormDraftScope(runtime({ tenant: null }))).toBeNull();
  });
});
