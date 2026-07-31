import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
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
const deployedHead = 'a'.repeat(40);
const correctiveHead = 'b'.repeat(40);
const deploymentIdHash = 'c'.repeat(64);
const finalCertificationHead = 'd'.repeat(40);
const secondDeploymentIdHash = 'e'.repeat(64);
const thirdDeploymentIdHash = '3c212866b1c49c3cf983d8f0d35a374c5effd99dc38ae1c3d6f3c0b0085f7a41';
const thirdPreviewHead = '978dd2b20c7338722b9bd3595a72dd4dfbbcbb66';
const recertificationHead = 'f'.repeat(40);
const runtimeFailureCode = 'FUNCTION_RUNTIME_MODULE_FORMAT_MISMATCH';
const transitiveRuntimeFailureCode = 'TRANSITIVE_GENERATED_MODULE_FORMAT_MISMATCH';
const publicRuntimeEnvironmentFailureCode = 'PUBLIC_STATIC_ENV_AND_OG_ESM_INTEROP_MISMATCH';
const publicAssetSource = [
  'const url="https://public-fixture.supabase.co/";',
  'const key="sb_publishable_fixture_public_key_123456";',
  'const storageKey="lanzo-public-store-auth";',
  'export const configured=Boolean(url&&key&&storageKey);',
].join('');
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

function initialPreviewPlan(overrides = {}) {
  return {
    deploymentPolicy: 'single-preview',
    projectName: 'lanzo-store',
    deploymentType: 'preview',
    production: false,
    previousPreviewDeployments: 0,
    head: deployedHead,
    correctivePreviewAuthorized: false,
    correctivePreviewNumber: 0,
    correctivePreviewExecuted: false,
    previousCorrectivePreviewDeployments: 0,
    commandArgs: ['deploy', '--prebuilt', '--yes'],
    ...overrides,
  };
}

function correctivePreviewPlan(overrides = {}) {
  return {
    deploymentPolicy: 'single-corrective-preview',
    projectName: 'lanzo-store',
    deploymentType: 'preview',
    production: false,
    previousPreviewDeployments: 1,
    previousPreviewProjectName: 'lanzo-store',
    previousPreviewDeploymentType: 'preview',
    previousPreviewProduction: false,
    previousPreviewStatus: 'FAILED_CERTIFICATION',
    previousPreviewEvidencePass: false,
    previousPreviewDeploymentIdHash: deploymentIdHash,
    previousPreviewHead: deployedHead,
    previousPreviewPreserved: true,
    head: correctiveHead,
    headRelationship: 'validated-descendant',
    headAncestryVerified: true,
    previousFailureCode: runtimeFailureCode,
    correctionFailureCode: runtimeFailureCode,
    correctivePreviewAuthorized: true,
    correctivePreviewNumber: 1,
    correctivePreviewExecuted: false,
    previousCorrectivePreviewDeployments: 0,
    commandArgs: ['deploy', '--prebuilt', '--yes'],
    ...overrides,
  };
}

function finalCertificationPreviewPlan(overrides = {}) {
  return {
    deploymentPolicy: 'single-final-certification-preview',
    projectName: 'lanzo-store',
    deploymentType: 'preview',
    production: false,
    previousPreviewDeployments: 2,
    previousPreviews: [
      {
        projectName: 'lanzo-store',
        deploymentType: 'preview',
        production: false,
        status: 'FAILED_CERTIFICATION',
        evidencePass: false,
        deploymentIdHash,
        head: deployedHead,
        preserved: true,
        failureCode: runtimeFailureCode,
      },
      {
        projectName: 'lanzo-store',
        deploymentType: 'preview',
        production: false,
        status: 'FAILED_CERTIFICATION',
        evidencePass: false,
        deploymentIdHash: secondDeploymentIdHash,
        head: correctiveHead,
        preserved: true,
        failureCode: transitiveRuntimeFailureCode,
      },
    ],
    head: finalCertificationHead,
    headRelationship: 'validated-descendant',
    headAncestryVerified: true,
    previousFailureCode: transitiveRuntimeFailureCode,
    correctionFailureCode: transitiveRuntimeFailureCode,
    previousCorrectivePreviewDeployments: 1,
    finalCertificationAuthorized: true,
    finalCertificationNumber: 1,
    finalCertificationExecuted: false,
    commandArgs: ['deploy', '--prebuilt', '--yes'],
    ...overrides,
  };
}

function recertificationPreviewPlan(overrides = {}) {
  return {
    deploymentPolicy: 'single-recertification-preview',
    projectName: 'lanzo-store',
    deploymentType: 'preview',
    production: false,
    previousPreviewDeployments: 3,
    previousPreviews: [
      ...finalCertificationPreviewPlan().previousPreviews,
      {
        projectName: 'lanzo-store',
        deploymentType: 'preview',
        production: false,
        status: 'FAILED_CERTIFICATION',
        evidencePass: false,
        deploymentIdHash: thirdDeploymentIdHash,
        head: thirdPreviewHead,
        preserved: true,
        failureCode: publicRuntimeEnvironmentFailureCode,
      },
    ],
    head: recertificationHead,
    headRelationship: 'validated-descendant',
    headAncestryVerified: true,
    previousFailureCode: publicRuntimeEnvironmentFailureCode,
    correctionFailureCode: publicRuntimeEnvironmentFailureCode,
    previousCorrectivePreviewDeployments: 1,
    previousFinalCertificationPreviewDeployments: 1,
    recertificationAuthorized: true,
    recertificationNumber: 1,
    recertificationExecuted: false,
    commandArgs: ['deploy', '--prebuilt', '--yes'],
    ...overrides,
  };
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
    return response(publicAssetSource, {
      contentType: 'text/javascript',
      cacheControl: 'public, max-age=31536000, immutable',
    });
  }
  throw new Error(`Unexpected fixture request: ${url.pathname}${url.search}`);
}

function withFixtureOverride(overrides = {}) {
  return async (input, options = {}) => {
    const url = new URL(input);
    if (overrides.assetSource && url.pathname === assetPath && options.method !== 'HEAD') {
      return response(overrides.assetSource, {
        contentType: 'text/javascript',
        cacheControl: 'public, max-age=31536000, immutable',
      });
    }
    if (
      overrides.ogHtml
      && url.pathname === '/api/og/store'
      && options.method !== 'HEAD'
    ) {
      return response('<!doctype html><h1>FUNCTION_INVOCATION_FAILED</h1>', {
        status: 500,
        contentType: 'text/html; charset=utf-8',
        cacheControl: 'no-store',
      });
    }
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
    if (cacheKey && (overrides.duplicateContentType || overrides.duplicateCacheControl)) {
      const bytes = new Uint8Array(await original.arrayBuffer());
      const headers = new Headers(original.headers);
      if (overrides.duplicateContentType) headers.append('Content-Type', 'image/png');
      if (overrides.duplicateCacheControl) headers.append('Cache-Control', headers.get('Cache-Control'));
      return new Response(options.method === 'HEAD' ? null : bytes, {
        status: original.status,
        headers,
      });
    }
    if (
      !cacheKey
      || overrides[cacheKey] === null
      || overrides[cacheKey] === undefined
    ) return original;
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

  it('autoriza la primera preview solo con historial vacío y count 0', () => {
    expect(validatePreviewDeploymentPlan(initialPreviewPlan())).toMatchObject({
      deploymentPolicy: 'single-preview',
      previousPreviewCount: 0,
      correctivePreviewAuthorized: false,
      correctivePreviewExecuted: false,
      production: false,
    });
  });

  it('autoriza una única preview correctiva tras la certificación fallida', () => {
    expect(validatePreviewDeploymentPlan(correctivePreviewPlan())).toMatchObject({
      deploymentPolicy: 'single-corrective-preview',
      previousPreviewCount: 1,
      previousPreviewProjectName: 'lanzo-store',
      previousPreviewDeploymentType: 'preview',
      previousPreviewFailedCertification: true,
      previousPreviewEvidencePass: false,
      previousPreviewDeploymentIdHash: deploymentIdHash,
      previousPreviewPreserved: true,
      headRelationship: 'validated-descendant',
      headAncestryVerified: true,
      correctionFailureCode: runtimeFailureCode,
      correctivePreviewAuthorized: true,
      correctivePreviewNumber: 1,
      correctivePreviewExecuted: false,
      command: 'vercel deploy --prebuilt --yes',
      production: false,
    });
    expect(validatePreviewDeploymentPlan(correctivePreviewPlan({
      headRelationship: 'direct-descendant',
      headParent: deployedHead,
      headAncestryVerified: undefined,
    }))).toMatchObject({
      headRelationship: 'direct-descendant',
      headAncestryVerified: true,
    });
  });

  it('rechaza flujo correctivo sin exactamente una preview anterior', () => {
    expect(() => validatePreviewDeploymentPlan(correctivePreviewPlan({
      previousPreviewDeployments: 0,
    }))).toThrow('requires exactly one');
    expect(() => validatePreviewDeploymentPlan(correctivePreviewPlan({
      previousPreviewDeployments: 2,
    }))).toThrow('requires exactly one');
  });

  it('rechaza una preview anterior que ya produjo evidencia PASS', () => {
    expect(() => validatePreviewDeploymentPlan(correctivePreviewPlan({
      previousPreviewEvidencePass: true,
    }))).toThrow('without PASS evidence');
  });

  it('rechaza una segunda preview correctiva', () => {
    expect(() => validatePreviewDeploymentPlan(correctivePreviewPlan({
      previousCorrectivePreviewDeployments: 1,
    }))).toThrow('unexecuted corrective preview');
    expect(() => validatePreviewDeploymentPlan(correctivePreviewPlan({
      correctivePreviewExecuted: true,
    }))).toThrow('unexecuted corrective preview');
  });

  it('autoriza una única certificación final después de dos previews fallidas', () => {
    expect(validatePreviewDeploymentPlan(finalCertificationPreviewPlan())).toMatchObject({
      deploymentPolicy: 'single-final-certification-preview',
      previousPreviewCount: 2,
      previousPreviewFailedCertifications: 2,
      previousPreviewEvidencePass: false,
      previousPreviewsPreserved: true,
      previousPreviewDeploymentIdHashes: [deploymentIdHash, secondDeploymentIdHash],
      previousFailureCodes: [runtimeFailureCode, transitiveRuntimeFailureCode],
      correctionFailureCode: transitiveRuntimeFailureCode,
      finalCertificationAuthorized: true,
      finalCertificationNumber: 1,
      finalCertificationExecuted: false,
      maximumTotalPreviewCount: 3,
      fourthPreviewForbidden: true,
      command: 'vercel deploy --prebuilt --yes',
      production: false,
    });
  });

  it('autoriza exactamente una cuarta preview de recertificación y prohíbe una quinta', () => {
    expect(validatePreviewDeploymentPlan(recertificationPreviewPlan())).toMatchObject({
      deploymentPolicy: 'single-recertification-preview',
      previousPreviewCount: 3,
      previousPreviewFailedCertifications: 3,
      previousPreviewEvidencePass: false,
      previousPreviewsPreserved: true,
      previousPreviewDeploymentIdHashes: [
        deploymentIdHash,
        secondDeploymentIdHash,
        thirdDeploymentIdHash,
      ],
      previousFailureCodes: [
        runtimeFailureCode,
        transitiveRuntimeFailureCode,
        publicRuntimeEnvironmentFailureCode,
      ],
      correctionFailureCode: publicRuntimeEnvironmentFailureCode,
      recertificationAuthorized: true,
      recertificationNumber: 1,
      recertificationExecuted: false,
      fourthPreviewAuthorized: true,
      maximumTotalPreviewCount: 4,
      fifthPreviewForbidden: true,
      command: 'vercel deploy --prebuilt --yes',
      production: false,
    });
  });

  it.each([
    ['quinta preview', { previousPreviewDeployments: 4 }, 'At most three'],
    ['tercera preview PASS', {
      previousPreviews: recertificationPreviewPlan().previousPreviews.map((entry, index) => (
        index === 2 ? { ...entry, evidencePass: true } : entry
      )),
    }, 'without PASS evidence'],
    ['hash plano', {
      previousPreviews: recertificationPreviewPlan().previousPreviews.map((entry, index) => (
        index === 2 ? { ...entry, deploymentIdHash: 'dpl_plain_identifier' } : entry
      )),
    }, 'SHA-256'],
    ['failure code distinto', {
      correctionFailureCode: transitiveRuntimeFailureCode,
    }, 'public runtime environment failure'],
    ['ancestry ausente', { headAncestryVerified: false }, 'descend from the third'],
    ['recertificación ya ejecutada', { recertificationExecuted: true }, 'unexecuted fourth-preview'],
  ])('rechaza recertificación contradictoria: %s', (_label, override, message) => {
    expect(() => validatePreviewDeploymentPlan(recertificationPreviewPlan(override)))
      .toThrow(message);
  });

  it('rechaza historial distinto de exactamente dos previews para certificación final', () => {
    expect(() => validatePreviewDeploymentPlan(finalCertificationPreviewPlan({
      previousPreviewDeployments: 1,
    }))).toThrow('exactly two');
    expect(() => validatePreviewDeploymentPlan(finalCertificationPreviewPlan({
      previousPreviewDeployments: 3,
    }))).toThrow('exactly two');
  });

  it.each([
    ['PASS previo', {
      previousPreviews: finalCertificationPreviewPlan().previousPreviews.map((entry, index) => (
        index === 1 ? { ...entry, evidencePass: true } : entry
      )),
    }, 'without PASS evidence'],
    ['preview no preservada', {
      previousPreviews: finalCertificationPreviewPlan().previousPreviews.map((entry, index) => (
        index === 1 ? { ...entry, preserved: false } : entry
      )),
    }, 'must remain preserved'],
    ['ID plano', {
      previousPreviews: finalCertificationPreviewPlan().previousPreviews.map((entry, index) => (
        index === 1 ? { ...entry, deploymentIdHash: 'dpl_plain_identifier' } : entry
      )),
    }, 'SHA-256'],
    ['fallos fuera de orden', {
      previousPreviews: finalCertificationPreviewPlan().previousPreviews.toReversed(),
    }, 'two diagnosed runtime failures in order'],
    ['corrección no relacionada', {
      correctionFailureCode: runtimeFailureCode,
    }, 'transitive module failure'],
    ['ancestry ausente', {
      headAncestryVerified: false,
    }, 'descend from the latest'],
    ['certificación final ya ejecutada', {
      finalCertificationExecuted: true,
    }, 'unexecuted final certification'],
  ])('rechaza una cuarta preview o evidencia final contradictoria: %s', (_label, override, message) => {
    expect(() => validatePreviewDeploymentPlan(finalCertificationPreviewPlan(override)))
      .toThrow(message);
  });

  it('rechaza producción en cualquier flujo', () => {
    expect(() => validatePreviewDeploymentPlan(initialPreviewPlan({
      production: true,
    }))).toThrow('Production deployments');
    expect(() => validatePreviewDeploymentPlan(correctivePreviewPlan({
      deploymentType: 'production',
    }))).toThrow('Production deployments');
    expect(() => validatePreviewDeploymentPlan(finalCertificationPreviewPlan({
      production: true,
    }))).toThrow('Production deployments');
  });

  it('conserva exactamente deploy --prebuilt --yes y rechaza prod, promote o alias', () => {
    for (const commandArgs of [
      ['deploy', '--prebuilt', '--yes', '--prod'],
      ['promote'],
      ['alias'],
      ['deploy', '--prebuilt'],
    ]) {
      expect(() => validatePreviewDeploymentPlan(correctivePreviewPlan({ commandArgs })))
        .toThrow('Only vercel deploy');
      expect(() => validatePreviewDeploymentPlan(finalCertificationPreviewPlan({ commandArgs })))
        .toThrow('Only vercel deploy');
      expect(() => validatePreviewDeploymentPlan(recertificationPreviewPlan({ commandArgs })))
        .toThrow('Only vercel deploy');
    }
  });

  it.each([
    ['historial previo en flujo inicial', initialPreviewPlan({
      previousPreviewStatus: 'FAILED_CERTIFICATION',
    }), 'history is contradictory'],
    ['proyecto previo distinto', correctivePreviewPlan({
      previousPreviewProjectName: 'lanzo-pos',
    }), 'non-production lanzo-store preview'],
    ['preview previa productiva', correctivePreviewPlan({
      previousPreviewProduction: true,
    }), 'non-production lanzo-store preview'],
    ['estado previo no fallido', correctivePreviewPlan({
      previousPreviewStatus: 'READY',
    }), 'failed certification'],
    ['ID plano', correctivePreviewPlan({
      previousPreviewDeploymentIdHash: 'dpl_plain_identifier',
    }), 'SHA-256'],
    ['HEAD sin ancestry validada', correctivePreviewPlan({
      headAncestryVerified: false,
    }), 'direct or validated descendant'],
    ['corrección ajena al fallo', correctivePreviewPlan({
      correctionFailureCode: 'OTHER_FAILURE',
    }), 'match the diagnosed'],
    ['evidencia no saneada', {
      ...correctivePreviewPlan(),
      previousPreviewDeploymentId: 'dpl_plain_identifier',
    }, 'Unexpected or unsanitized'],
  ])('rechaza evidencia contradictoria o no saneada: %s', (_label, plan, message) => {
    expect(() => validatePreviewDeploymentPlan(plan)).toThrow(message);
  });

  it('preserva la preview fallida y no muta su historial diagnóstico', () => {
    const plan = Object.freeze(correctivePreviewPlan());
    const before = JSON.stringify(plan);
    const evidence = validatePreviewDeploymentPlan(plan);
    expect(evidence.previousPreviewPreserved).toBe(true);
    expect(evidence.previousPreviewDeploymentIdHash).toBe(deploymentIdHash);
    expect(JSON.stringify(plan)).toBe(before);
    expect(JSON.stringify(evidence)).not.toContain('dpl_');
  });

  it('valida el plan sin realizar llamadas a Vercel ni a la red', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(
      new Error('Network access is forbidden in this test.'),
    );
    expect(validatePreviewDeploymentPlan(correctivePreviewPlan()))
      .toMatchObject({ correctivePreviewAuthorized: true });
    expect(validatePreviewDeploymentPlan(finalCertificationPreviewPlan()))
      .toMatchObject({ finalCertificationAuthorized: true });
    expect(validatePreviewDeploymentPlan(recertificationPreviewPlan()))
      .toMatchObject({ recertificationAuthorized: true });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
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
      writeFile(path.join(root, assetPath.slice(1)), publicAssetSource),
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
    expect(result).toMatchObject({
      serverHtmlPassed: true,
      clientConfigurationPassed: true,
      clientStoreLoadPassed: true,
      ogRuntimePassed: true,
    });
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
      writeFile(path.join(root, assetPath.slice(1)), publicAssetSource),
    ]);
    for (const [override, expectedCheck] of [
      [{ ogUnversioned: 'public, no-store' }, 'og:png'],
      [{ ogVersioned: 'public, max-age=31536000' }, 'og-versioned:png'],
      [{ dynamicHtml: 'public, s-maxage=300, immutable' }, 'store:metadata'],
      [{ asset: 'public, max-age=31536000' }, 'asset:immutable'],
      [{ duplicateContentType: true }, 'og:png'],
      [{ duplicateCacheControl: true }, 'og:png'],
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

  it.each([
    ['placeholder estático', {
      assetSource: `${publicAssetSource};const bad="supabase.invalid";`,
    }, ['store:client-configuration', 'store:client-load']],
    ['HTML de error OG', {
      ogHtml: true,
    }, ['og:png', 'og-versioned:png', 'og:runtime']],
  ])('bloquea el fallo remoto real: %s', async (_label, override, expectedChecks) => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'lanzo-store-remote-runtime-fixture-'));
    const indexPath = path.join(root, 'index.html');
    await mkdir(path.join(root, 'assets'), { recursive: true });
    await Promise.all([
      writeFile(indexPath, staticHtml),
      writeFile(path.join(root, assetPath.slice(1)), publicAssetSource),
    ]);
    const result = await auditRemoteStoreDeployment({
      baseUrl: preview,
      slug,
      fetchImpl: withFixtureOverride(override),
      localIndexPath: indexPath,
    });
    expect(result.status).toBe('BLOCKED');
    expect(result.failedChecks).toEqual(expect.arrayContaining(expectedChecks));
  });

  it('acepta copy legítimo con otro/externo y bloquea slug estructural alterado', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'lanzo-store-hostile-query-fixture-'));
    const indexPath = path.join(root, 'index.html');
    await mkdir(path.join(root, 'assets'), { recursive: true });
    await Promise.all([
      writeFile(indexPath, staticHtml),
      writeFile(path.join(root, assetPath.slice(1)), publicAssetSource),
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
