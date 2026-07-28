export const STORE_SOCIAL_HEAD_START = '<!-- LANZO_SOCIAL_HEAD_START -->';
export const STORE_SOCIAL_HEAD_END = '<!-- LANZO_SOCIAL_HEAD_END -->';

const SOCIAL_TAG_PATTERN = /<title(?:\s|>)|<meta\b[^>]*(?:\bname=["'](?:description|twitter:[^"']*)["']|\bproperty=["']og:[^"']*["'])[^>]*>|<link\b[^>]*\brel=["']canonical["'][^>]*>/iu;
const HASHED_ASSET_PATTERN = /(?:src|href)="\/assets\/[^"]+-[A-Za-z0-9_-]{6,}\.(?:js|css)"/gu;
const FORBIDDEN_TEMPLATE_PATTERN = /(?:process\.env|import\.meta\.env|VITE_[A-Z0-9_]+|SUPABASE_(?:PRIVATE|SECRET)_KEY|sourceMappingURL|\/assets\/[^"']*(?:admin|dashboard|pospage)[^"']*)/iu;

export class StoreHtmlTemplateError extends Error {
  constructor() {
    super('Store HTML template is invalid.');
    this.name = 'StoreHtmlTemplateError';
  }
}

function countOccurrences(source, token) {
  return source.split(token).length - 1;
}

export function inspectStoreHtmlTemplate(template) {
  if (typeof template !== 'string') throw new StoreHtmlTemplateError();
  const startCount = countOccurrences(template, STORE_SOCIAL_HEAD_START);
  const endCount = countOccurrences(template, STORE_SOCIAL_HEAD_END);
  const rootCount = (template.match(/\bid="root"/gu) || []).length;
  const startIndex = template.indexOf(STORE_SOCIAL_HEAD_START);
  const endIndex = template.indexOf(STORE_SOCIAL_HEAD_END);
  const headStartIndex = template.search(/<head(?:\s|>)/iu);
  const headEndIndex = template.search(/<\/head>/iu);
  const charsetIndex = template.search(/<meta\b[^>]*\bcharset=/iu);
  const viewportIndex = template.search(
    /<meta\b[^>]*\bname=["']viewport["'][^>]*>/iu,
  );
  const hasOrderedMarkers = startCount === 1
    && endCount === 1
    && startIndex >= 0
    && endIndex > startIndex;
  const outsideSocialBlock = hasOrderedMarkers
    ? `${template.slice(0, startIndex)}${template.slice(endIndex + STORE_SOCIAL_HEAD_END.length)}`
    : template;
  const hashedAssets = template.match(HASHED_ASSET_PATTERN) || [];

  const checks = Object.freeze({
    doctype: /^\s*<!doctype html>/iu.test(template),
    html: /<html(?:\s|>)/iu.test(template),
    head: /<head(?:\s|>)/iu.test(template),
    body: /<body(?:\s|>)/iu.test(template),
    markers: hasOrderedMarkers,
    markerPlacement: (
      headStartIndex >= 0
      && charsetIndex > headStartIndex
      && viewportIndex > charsetIndex
      && startIndex > viewportIndex
      && endIndex > startIndex
      && headEndIndex > endIndex
    ),
    root: rootCount === 1,
    moduleScript: /<script\b[^>]*\btype="module"[^>]*\bsrc="\/assets\/[^"]+-[A-Za-z0-9_-]{6,}\.js"[^>]*><\/script>/iu.test(template),
    stylesheet: /<link\b[^>]*\brel="stylesheet"[^>]*\bhref="\/assets\/[^"]+-[A-Za-z0-9_-]{6,}\.css"[^>]*>/iu.test(template),
    hashedAssets: hashedAssets.length >= 2,
    noSocialDuplicates: !SOCIAL_TAG_PATTERN.test(outsideSocialBlock),
    safeContent: !FORBIDDEN_TEMPLATE_PATTERN.test(template),
  });
  return Object.freeze({
    valid: Object.values(checks).every(Boolean),
    checks,
    startIndex,
    endIndex,
  });
}

export function validateStoreHtmlTemplate(template) {
  const inspection = inspectStoreHtmlTemplate(template);
  if (!inspection.valid) throw new StoreHtmlTemplateError();
  return inspection;
}

export function injectSocialHead(template, socialHead) {
  if (typeof socialHead !== 'string' || /<script(?:\s|>)/iu.test(socialHead)) {
    throw new StoreHtmlTemplateError();
  }
  const inspection = validateStoreHtmlTemplate(template);
  const contentStart = inspection.startIndex + STORE_SOCIAL_HEAD_START.length;
  return [
    template.slice(0, contentStart),
    '\n',
    socialHead,
    '\n',
    template.slice(inspection.endIndex),
  ].join('');
}
