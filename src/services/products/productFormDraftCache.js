// Keep unsaved form values across a temporary PermissionRoute fallback without
// writing product data to local storage. Drafts are scoped to one actor session
// and tenant, so they cannot be restored after a tenant or session change.
const drafts = new Map();

export const createProductFormDraftScope = (runtime = null) => {
  if (runtime?.status !== 'granted') return null;
  const tenantId = runtime?.tenant?.opaqueId;
  const actorKey = runtime?.actorKey;
  const sessionId = runtime?.sessionId;
  if (!tenantId || !actorKey || !sessionId) return null;
  return JSON.stringify([tenantId, actorKey, sessionId]);
};

export const readProductFormDraft = (scope) => {
  if (!scope) return null;
  for (const existingScope of drafts.keys()) {
    if (existingScope !== scope) drafts.delete(existingScope);
  }
  const draft = drafts.get(scope);
  return draft ? { ...draft, values: { ...draft.values } } : null;
};

export const saveProductFormDraft = (scope, draft) => {
  if (!scope || !draft || typeof draft.values !== 'object' || !draft.values) return false;
  drafts.set(scope, { ...draft, values: { ...draft.values } });
  return true;
};

export const clearProductFormDraft = (scope) => {
  if (scope) drafts.delete(scope);
};
