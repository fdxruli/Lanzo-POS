import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  auditRemoteStoreDeployment,
  inspectPng,
  inspectSecurityMarkers,
  inspectSocialHtml,
  parseCacheControl,
  parseAuditArguments,
  validateCacheControl,
  validatePreviewDeploymentPlan,
  validatePreviewUrl,
} from '../../../scripts/audit-remote-store-deployment.mjs';

const slug = 'tienda-publica-fixture';
const preview = 'https://lanzo-store-git-fixture-team.vercel.app';
const assetPath = '/assets/index-AbCd1234.js';
const staticHtml = `<!doctype html><html lang="es-MX"><head>
<title>Tienda en línea | Lanzo</title>
<meta name="description" content="Consulta productos">
<script type="module" src="${assetPath}"></script>
<link rel="stylesheet" href="/assets/index-ZyXw9876.css">
</head><body><div id="root"></div></body></html>`;

function socialHtml(name = 'Tienda pública', effectiveSlug = slug) {
  const canonical = `${preview}/tienda/${effectiveSlug}`;
  const image = `${preview}/api/og/store?slug=${effectiveSlug}&v=1`;
  return `<!doctype html><html lang="es-MX"><head>
<title>${name} | Tienda en línea</title>
<meta name="description" content="Conoce otro sabor y servicio externo disponible.">
<link rel="canonical" href="${canonical}">
<meta property="og:title" content="${name} | Tienda en línea">
<meta property="og:description" content="Conoce otro sabor y servicio externo disponible.">
<meta property="og:url" content="${canonical}">
<meta property="og:image" content="${image}">
<meta property="og:type" content="website">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${name} | Tienda en línea">
<meta name="twitter:description" content="Conoce otro sabor y servicio externo disponible.">
<meta name="twitter:image" content="${image}">
<script type="module" src="${assetPath}"></script>
<link rel="stylesheet" href="/assets/index-ZyXw9876.css">
</head><body><div id="root"></div></body></html>`;
}

function genericHtml() {
  return `<!doctype html><html lang="es-MX"><head><title>Tienda no disponible | Lanzo</title>
<meta name="description" content="Esta tienda no está disponible.">
</head><body><div id="root"></div></body></html>`;
}

function pngFixture() {
  const bytes = Buffer.alloc(1_024, 0);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes, 0);
  bytes.writeUInt32BE(1200, 16);
  bytes.writeUInt32BE(630, 20);
  return bytes;
}

function response(body, {
  status = 200,
  contentType = 'text/html; charset=utf-8',
  cacheControl = 'public, max-age=0, must-revalidate',
  location = '',
} = {}) {
  return new Response(body, {
    status,
    headers: {
      'Content-Type': contentType,
      'Cache-Control': cacheControl,
      'X-Robots-Tag': 'noindex, nofollow, noarchive',
      ...(location ? { Location: location } : {}),
    },
  });
}

async function fixtureFetch(input, options = {}) {
  const url = new URL(input);
  if (options.method === 'HEAD') {
    const contentType = url.pathname.startsWith('/api/og/') ? 'image/png' : 'text/html; charset=utf-8';
    const cacheControl = url.pathname.startsWith('/assets/')
      ? 'public, max-age=31536000, immutable'
      : (url.pathname.startsWith('/tienda/') && !url.pathname.includes('/pedido/')
          ? 'public, max-age=0, s-maxage=300, stale-while-revalidate=86400'
          : 'public, max-age=0, must-revalidate');
    return response(null, { contentType, cacheControl });
  }
  if (url.pathname === `/tienda/${slug}/`) {
    return response(null, {
      status: 308,
      location: `/tienda/${slug}`,
      cacheControl: 'public, max-age=0, s-maxage=300',
    });
  }
  if (
    url.pathname === `/tienda/${slug}`
    || (url.pathname === '/api/store-page' && url.searchParams.get('slug') === slug)
  ) {
    return response(socialHtml(), {
      cacheControl: 'public, max-age=0, s-maxage=300, stale-while-revalidate=86400',
    });
  }
  if (url.pathname === `/tienda/${slug}/pedido/token-ficticio`
    || url.pathname === `/tienda/${slug}/ruta-desconocida`
    || url.pathname === '/'
    || url.pathname === '/tienda') {
    return response(staticHtml);
  }
  if (url.pathname === `/tienda/${'slug-inexistente-controlado'}`
    || (url.pathname === '/api/store-page' && url.searchParams.get('slug') === 'slug-inexistente-controlado')) {
    return response(genericHtml(), { cacheControl: 'public, max-age=0, s-maxage=300' });
  }
  if (url.pathname === '/api/store-page' && url.searchParams.get('slug') === 'INVALIDO') {
    return response('Invalid request.', {
      status: 400,
      contentType: 'text/plain; charset=utf-8',
      cacheControl: 'no-store',
    });
  }
  if (url.pathname === '/api/og/store') {
    return response(pngFixture(), {
      contentType: 'image/png',
      cacheControl: url.searchParams.has('v')
        ? 'public, max-age=31536000, immutable'
        : 'public, max-age=0, s-maxage=300, stale-while-revalidate=86400',
    });
  }
  if (url.pathname === assetPath) {
    return response('export const store=true;', {
      contentType: 'text/javascript',
      cacheControl: 'public, max-age=31536000, immutable',
    });
  }
  throw new Error(`Unexpected fixture request: ${url.pathname}${url.search}`);
}

function withFixtureOverride(overrides = {}) {
  return async (input, options = {}) => {
    const url = new URL(input);
    if (
      overrides.poisonHostileQuery
      && url.pathname === `/tienda/${slug}`
      && url.searchParams.has('slug')
    ) {
      return response(socialHtml('Tienda pública', 'externo'), {
        cacheControl: 'public, max-age=0, s-maxage=300, stale-while-revalidate=86400',
      });
    }
    const original = await fixtureFetch(input, options);
    const cacheKey = url.pathname === '/api/og/store'
      ? (url.searchParams.has('v') ? 'ogVersioned' : 'ogUnversioned')
      : (url.pathname === `/tienda/${slug}` ? 'dynamicHtml'
          : (url.pathname === assetPath ? 'asset' : null));
    if (!cacheKey || overrides[cacheKey] == null) return original;
    const bytes = new Uint8Array(await original.arrayBuffer());
    const headers = new Headers(original.headers);
    headers.set('Cache-Control', overrides[cacheKey]);
    return new Response(options.method === 'HEAD' ? null : bytes, {
      status: original.status,
      headers,
    });
  };
}

describe('validación remota saneada de lanzo-store', () => {
  it('acepta solo un host preview HTTPS y argumentos explícitos', () => {
    expect(validatePreviewUrl(preview).hostname).toContain('lanzo-store-');
    expect(() => validatePreviewUrl('https://tienda.example.com')).toThrow('Vercel preview');
    expect(() => validatePreviewUrl(preview, {
      productionHosts: ['lanzo-store-git-fixture-team.vercel.app'],
    })).toThrow('Production');
    expect(() => validatePreviewUrl('https://lanzo-store.vercel.app')).toThrow('Production');
    expect(parseAuditArguments(['--base-url', preview, '--slug', slug])).toMatchObject({ slug });
    expect(() => parseAuditArguments(['--base-url', preview, '--slug', slug, '--prod', '1']))
      .toThrow('Expected');
    expect(() => parseAuditArguments(['--base-url', preview, '--slug', slug, '--alias', 'x']))
      .toThrow('Expected');
    expect(() => parseAuditArguments(['--base-url', preview, '--slug', slug, '--promote', 'x']))
      .toThrow('Expected');
  });

  it('limita el plan a una sola preview prebuilt de lanzo-store', () => {
    expect(validatePreviewDeploymentPlan({
      projectName: 'lanzo-store',
      deploymentType: 'preview',
      production: false,
      previousPreviewDeployments: 0,
      commandArgs: ['deploy', '--prebuilt', '--yes'],
    })).toMatchObject({ projectName: 'lanzo-store', production: false });
    expect(() => validatePreviewDeploymentPlan({
      projectName: 'lanzo-store',
      deploymentType: 'preview',
      production: false,
      previousPreviewDeployments: 1,
      commandArgs: ['deploy', '--prebuilt', '--yes'],
    })).toThrow('Only one preview');
    for (const commandArgs of [
      ['deploy', '--prebuilt', '--yes', '--prod'],
      ['promote'],
      ['alias'],
    ]) {
      expect(() => validatePreviewDeploymentPlan({
        projectName: 'lanzo-store',
        deploymentType: 'preview',
        production: false,
        previousPreviewDeployments: 0,
        commandArgs,
      })).toThrow('Only vercel deploy');
    }
  });

  it('cuenta metadata única, canonical e imagen sin persistir HTML', () => {
    const inspection = inspectSocialHtml(socialHtml());
    expect(Object.values(inspection.counts).every((count) => count === 1)).toBe(true);
    expect(inspection.canonicalPath).toBe(`/tienda/${slug}`);
    expect(inspection.ogUrlPath).toBe(`/tienda/${slug}`);
    expect(inspection.fullHtml).toBeUndefined();
    expect(JSON.stringify(inspection)).not.toContain('<!doctype');
  });

  it('detecta PNG 1200 × 630 y marcadores de alta precisión', () => {
    expect(inspectPng(pngFixture())).toMatchObject({ png: true, width: 1200, height: 630 });
    expect(inspectSecurityMarkers('copy de Caja público', 'fixture')).toEqual([]);
    expect(inspectSecurityMarkers('const x = "device_security_token"', 'asset')[0])
      .toMatchObject({ marker: 'device_security_token', relativeRoute: 'asset' });
  });

  it('rechaza una respuesta declarada como excesiva antes de conservar el cuerpo', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'lanzo-store-size-limit-fixture-'));
    const indexPath = path.join(root, 'index.html');
    await writeFile(indexPath, staticHtml);
    await expect(auditRemoteStoreDeployment({
      baseUrl: preview,
      slug,
      localIndexPath: indexPath,
      fetchImpl: async () => new Response('small fixture', {
        headers: {
          'Content-Type': 'text/html',
          'Content-Length': String(2 * 1024 * 1024 + 1),
        },
      }),
    })).rejects.toThrow('exceeds the audit limit');
  });

  it.each([
    ['OG sin versión correcta', 'public, stale-while-revalidate=86400, s-maxage=300, max-age=0', 'og-unversioned', true],
    ['OG sin versión no-store', 'public, no-store, max-age=0, s-maxage=300, stale-while-revalidate', 'og-unversioned', false],
    ['OG sin versión sin s-maxage', 'public, max-age=0, stale-while-revalidate', 'og-unversioned', false],
    ['OG versionada immutable', 'immutable, public, max-age=31536000', 'og-versioned', true],
    ['OG versionada sin immutable', 'public, max-age=31536000', 'og-versioned', false],
    ['OG versionada con caché corta', 'public, max-age=0, s-maxage=300, stale-while-revalidate', 'og-versioned', false],
    ['HTML dinámico immutable', 'public, max-age=0, s-maxage=300, immutable', 'dynamic-html', false],
    ['asset sin immutable', 'public, max-age=31536000', 'hashed-asset', false],
  ])('valida Cache-Control sin depender del orden: %s', (_label, value, policy, expected) => {
    expect(validateCacheControl(value, policy)).toBe(expected);
    expect(parseCacheControl(value)).not.toHaveProperty('raw');
  });

  it('valida routing, query hostil, tracking estático, PNG, caché y limpieza de cuerpos', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'lanzo-store-remote-fixture-'));
    const indexPath = path.join(root, 'index.html');
    await mkdir(path.join(root, 'assets'), { recursive: true });
    await Promise.all([
      writeFile(indexPath, staticHtml),
      writeFile(path.join(root, assetPath.slice(1)), 'export const store=true;'),
    ]);
    const result = await auditRemoteStoreDeployment({
      baseUrl: preview,
      slug,
      fetchImpl: fixtureFetch,
      localIndexPath: indexPath,
    });
    expect(result.status, JSON.stringify(result.failedChecks)).toBe('PASS');
    expect(result.hostileQueries).toHaveLength(3);
    expect(result.hostileQueries.slice(1).every((item) => (
      JSON.stringify(item.slugValues) === JSON.stringify([slug])
    ))).toBe(true);
    expect(result.metadata.canonicalPath).toBe(`/tienda/${slug}`);
    expect(result.ogImage).toMatchObject({ png: true, width: 1200, height: 630 });
    expect(result.security).toMatchObject({ passed: true, findings: [] });
    expect(JSON.stringify(result.requests)).not.toContain('<html');
    expect(JSON.stringify(result.requests)).not.toContain('137,80,78,71');
    expect(JSON.stringify(result.requests)).not.toMatch(/authorization|set-cookie/iu);
    expect(result.requests.find((item) => item.name === 'tracking')?.status).toBe(200);
  });

  it('rechaza caché OG, HTML o asset que viole su contrato', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'lanzo-store-remote-cache-fixture-'));
    const indexPath = path.join(root, 'index.html');
    await mkdir(path.join(root, 'assets'), { recursive: true });
    await Promise.all([
      writeFile(indexPath, staticHtml),
      writeFile(path.join(root, assetPath.slice(1)), 'export const store=true;'),
    ]);
    for (const [override, expectedCheck] of [
      [{ ogUnversioned: 'public, no-store' }, 'og:png'],
      [{ ogVersioned: 'public, max-age=31536000' }, 'og-versioned:png'],
      [{ dynamicHtml: 'public, s-maxage=300, immutable' }, 'store:metadata'],
      [{ asset: 'public, max-age=31536000' }, 'asset:immutable'],
    ]) {
      const result = await auditRemoteStoreDeployment({
        baseUrl: preview,
        slug,
        fetchImpl: withFixtureOverride(override),
        localIndexPath: indexPath,
      });
      expect(result.status).toBe('BLOCKED');
      expect(result.failedChecks).toContain(expectedCheck);
    }
  });

  it('acepta copy legítimo con otro/externo y bloquea slug estructural alterado', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'lanzo-store-hostile-query-fixture-'));
    const indexPath = path.join(root, 'index.html');
    await mkdir(path.join(root, 'assets'), { recursive: true });
    await Promise.all([
      writeFile(indexPath, staticHtml),
      writeFile(path.join(root, assetPath.slice(1)), 'export const store=true;'),
    ]);
    const valid = await auditRemoteStoreDeployment({
      baseUrl: preview,
      slug,
      fetchImpl: fixtureFetch,
      localIndexPath: indexPath,
    });
    expect(valid.status, JSON.stringify(valid.failedChecks)).toBe('PASS');
    const poisoned = await auditRemoteStoreDeployment({
      baseUrl: preview,
      slug,
      fetchImpl: withFixtureOverride({ poisonHostileQuery: true }),
      localIndexPath: indexPath,
    });
    expect(poisoned.status).toBe('BLOCKED');
    expect(poisoned.failedChecks).toEqual(expect.arrayContaining([
      'hostile-single:path-authoritative',
      'hostile-multiple:path-authoritative',
    ]));
  });
});
