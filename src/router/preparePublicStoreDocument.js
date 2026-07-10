export function preparePublicStoreDocument(documentRef = document) {
  const viewport = documentRef.querySelector('meta[name="viewport"]');
  if (!viewport) return;

  const directives = (viewport.getAttribute('content') || '')
    .split(',')
    .map((directive) => directive.trim())
    .filter(Boolean)
    .filter((directive) => !/^maximum-scale\s*=/i.test(directive))
    .filter((directive) => !/^user-scalable\s*=/i.test(directive));

  if (!directives.some((directive) => /^width\s*=/i.test(directive))) {
    directives.unshift('width=device-width');
  }
  if (!directives.some((directive) => /^initial-scale\s*=/i.test(directive))) {
    directives.push('initial-scale=1');
  }

  viewport.setAttribute('content', directives.join(', '));
}

export default preparePublicStoreDocument;
