import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  auditPrebuiltOutput,
  classifyCredentialAssignment,
  verifyTemporaryStoreRoot,
} from '../../../scripts/audit-vercel-build-output.mjs';
import {
  applyGeneratedFunctionRuntimeCompatibility,
  sanitizeFailedOutputDiagnostic,
} from '../../../scripts/prepare-store-deployment.mjs';

const PROJECT_ID = 'fixture-store-project';
const ORG_ID = 'fixture-store-org';
const CURRENT_NODE_RUNTIME = `nodejs${process.versions.node.split('.')[0]}.x`;
const PRIVILEGED_JWT = [
  Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'),
  Buffer.from(JSON.stringify({ role: 'service_role', fixture: true })).toString('base64url'),
  Buffer.from('fictitious-signature').toString('base64url'),
].join('.');
const INDEX_HTML = `<!doctype html><html><head>
<!-- LANZO_SOCIAL_HEAD_START --><title>Tienda</title><!-- LANZO_SOCIAL_HEAD_END -->
<link rel="stylesheet" href="/assets/index-AbCd1234.css"></head>
<body><div id="root"></div><script type="module" src="/assets/index-ZyXw9876.js"></script></body></html>`;

function validRoutes() {
  return [
    {
      src: '^/(.*)/$',
      status: 308,
      headers: { Location: '/$1', 'X-Robots-Tag': 'noindex, nofollow, noarchive' },
    },
    { src: '^/(.*)$', headers: { 'X-Robots-Tag': 'noindex, nofollow, noarchive' }, continue: true },
    {
      src: '^/assets/(.*)$',
      headers: { 'Cache-Control': 'public, max-age=31536000, immutable' },
      continue: true,
    },
    {
      src: '^/(?:index\\.html)?$',
      headers: { 'Cache-Control': 'public, max-age=0, must-revalidate' },
      continue: true,
    },
    { handle: 'filesystem' },
    { src: '^/tienda/([^/]+)/pedido/([^/]+)$', dest: '/index.html' },
    { src: '^/tienda/([^/]+)$', dest: '/api/store-page?slug=$1' },
    { src: '^/tienda/[^/]+/.+$', dest: '/index.html' },
    { src: '^/(?:|tienda|conoce-lanzo)$', dest: '/index.html' },
    { handle: 'error' },
  ];
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function createFunction(functionsRoot, relativeRoute, source) {
  const root = path.join(functionsRoot, `${relativeRoute}.func`);
  await mkdir(root, { recursive: true });
  await writeJson(path.join(root, '.vc-config.json'), {
    runtime: CURRENT_NODE_RUNTIME,
    handler: 'index.mjs',
  });
  await writeFile(path.join(root, 'index.mjs'), source);
  if (relativeRoute === 'api/og/store') {
    for (const packageName of ['@vercel/og', 'react']) {
      const packageRoot = path.join(root, 'node_modules', ...packageName.split('/'));
      await mkdir(packageRoot, { recursive: true });
      await writeJson(path.join(packageRoot, 'package.json'), {
        name: packageName,
        main: 'index.js',
      });
      await writeFile(
        path.join(packageRoot, 'index.js'),
        packageName === '@vercel/og'
          ? `exports.ImageResponse=class ImageResponse extends Response{
constructor(){super(Uint8Array.from([137,80,78,71,13,10,26,10]),{
status:200,headers:{"Content-Type":"image/png"}
});}
};\n`
          : 'module.exports={fixture:true};\n',
      );
    }
  }
}

async function createFixture() {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'lanzo-store-social-preview-1-6-'));
  const storeRoot = path.join(workspaceRoot, 'store');
  const sourceStatic = path.join(workspaceRoot, 'source-static');
  const outputRoot = path.join(workspaceRoot, '.vercel', 'output');
  const staticRoot = path.join(outputRoot, 'static');
  const functionsRoot = path.join(outputRoot, 'functions');
  await Promise.all([
    mkdir(path.join(staticRoot, 'assets'), { recursive: true }),
    mkdir(path.join(sourceStatic, 'assets'), { recursive: true }),
  ]);
  const staticFiles = {
    'index.html': INDEX_HTML,
    'robots.txt': 'User-agent: *\nDisallow: /\n',
    'assets/index-AbCd1234.css': 'body{color:#123456}',
    'assets/index-ZyXw9876.js': 'export const publicStore=true;',
  };
  for (const [relativePath, source] of Object.entries(staticFiles)) {
    await writeFile(path.join(staticRoot, relativePath), source);
    await writeFile(path.join(sourceStatic, relativePath), source);
  }
  const sourceConfigPath = path.join(workspaceRoot, 'store-vercel.json');
  await writeJson(sourceConfigPath, { trailingSlash: false });
  await writeJson(path.join(workspaceRoot, '.vercel', 'project.json'), {
    projectId: PROJECT_ID,
    orgId: ORG_ID,
  });
  await writeJson(path.join(outputRoot, 'config.json'), { version: 3, routes: validRoutes() });
  await writeJson(path.join(outputRoot, 'builds.json'), {
    target: 'preview',
    argv: ['build', '--debug', '--local-config', './store/vercel.prebuilt.json'],
  });
  await createFunction(
    functionsRoot,
    'api/store-page',
    `const STORE_HTML_TEMPLATE=${JSON.stringify(INDEX_HTML)};
function rejectsPrivileged(value,payload){
  const envName='SUPABASE_SERVICE_ROLE';
  const forbidden=/service_role/;
  return value.includes('service_role')
    || value.includes('supabase_service_role')
    || payload.role === 'service_role'
    || forbidden.test(value)
    || envName.length === 0;
}
export default {async fetch(){
  if(typeof rejectsPrivileged!=='function') throw new Error('fixture guard missing');
  return new Response(STORE_HTML_TEMPLATE,{
    status:200,
    headers:{"Content-Type":"text/html; charset=utf-8"}
  });
}};`,
  );
  await createFunction(
    functionsRoot,
    'api/og/store',
    `import {ImageResponse} from '@vercel/og';
import React from 'react';
export default {async fetch(){
  if(!React) throw new Error('react fixture missing');
  return new ImageResponse(null,{width:1200,height:630});
}};`,
  );
  return {
    workspaceRoot,
    storeRoot,
    sourceStatic,
    sourceConfigPath,
    outputRoot,
    staticRoot,
    functionsRoot,
  };
}

async function audit(fixture) {
  return auditPrebuiltOutput('store', fixture.workspaceRoot, {
    sourceConfigPath: fixture.sourceConfigPath,
    sourceStaticPath: fixture.sourceStatic,
    effectiveStoreRoot: fixture.storeRoot,
    expectedProjectId: PROJECT_ID,
    expectedOrganizationId: ORG_ID,
  });
}

describe('auditoría de .vercel/output', () => {
  let fixture;
  beforeEach(async () => {
    fixture = await createFixture();
  });

  it.each([
    ['production', { target: 'production', argv: ['build', '--prod'] }],
    ['target ausente', { argv: ['build'] }],
    ['flag production contradictorio', { target: 'preview', argv: ['build', '--target=production'] }],
  ])('rechaza el Build Output con %s', async (_label, builds) => {
    await writeJson(path.join(fixture.outputRoot, 'builds.json'), builds);
    const report = await audit(fixture);
    expect(report.status).toBe('FAIL');
    expect(report.failedChecks).toEqual(expect.arrayContaining([
      ...(!builds.target ? ['targetEnvironmentPresent'] : []),
      ...(builds.target !== 'preview' ? ['targetEnvironmentPreview'] : []),
      ...(builds.argv.some((value) => value.includes('production') || value === '--prod')
        ? ['noProductionBuildFlags']
        : []),
    ]));
  });

  it('acepta un output mínimo válido', async () => {
    const result = await audit(fixture);
    expect(result.status, JSON.stringify(result.failedChecks)).toBe('PASS');
    expect(result.output.functions).toEqual(['/api/og/store', '/api/store-page']);
    expect(result.routing.cases.map((item) => item.slugValues)).toEqual([
      ['mi-tienda'],
      ['mi-tienda'],
      ['mi-tienda'],
      ['mi-tienda'],
    ]);
  });

  it('reproduce el fallo transitorio de la plantilla y corrige atómicamente ambos scopes', async () => {
    const handlers = [
      {
        bundle: path.join(fixture.functionsRoot, 'api', 'store-page.func'),
        handler: 'store/api/store-page.js',
        source: `"use strict";
Object.defineProperty(exports,"__esModule",{value:true});
exports.default={fetch:async function(){
  try{
    const generated=await import("../generated/storeHtmlTemplate.js");
    return new Response(generated.STORE_HTML_TEMPLATE,{
      status:200,headers:{"Content-Type":"text/html; charset=utf-8"}
    });
  }catch{
    return new Response("Store page temporarily unavailable.",{
      status:500,headers:{"Content-Type":"text/plain; charset=utf-8","Cache-Control":"no-store"}
    });
  }
}};`,
      },
      {
        bundle: path.join(fixture.functionsRoot, 'api', 'og', 'store.func'),
        handler: 'store/api/og/store.js',
        source: `"use strict";
Object.defineProperty(exports,"__esModule",{value:true});
const {ImageResponse}=require("@vercel/og");
const React=require("react");
const runtimeHelper=require("../_ogRuntime.js");
exports.default={fetch:async function(){
  if(!React||!runtimeHelper.assertRuntime())throw new Error("OG runtime fixture missing");
  return new ImageResponse(null,{width:1200,height:630});
}};`,
      },
    ];
    for (const item of handlers) {
      await writeJson(path.join(item.bundle, 'package.json'), { type: 'module' });
      await writeJson(path.join(item.bundle, '.vc-config.json'), {
        runtime: CURRENT_NODE_RUNTIME,
        handler: item.handler,
      });
      await mkdir(path.dirname(path.join(item.bundle, item.handler)), { recursive: true });
      await writeFile(path.join(item.bundle, item.handler), item.source);
    }
    await writeFile(
      path.join(handlers[1].bundle, 'store', 'api', '_ogRuntime.js'),
      '"use strict";exports.assertRuntime=()=>true;',
    );
    const generatedRoot = path.join(handlers[0].bundle, 'store', 'generated');
    await mkdir(generatedRoot, { recursive: true });
    await writeFile(
      path.join(generatedRoot, 'storeHtmlTemplate.js'),
      `"use strict";
Object.defineProperty(exports,"__esModule",{value:true});
exports.STORE_HTML_TEMPLATE=${JSON.stringify(INDEX_HTML)};`,
    );

    let result = await audit(fixture);
    expect(result.status).toBe('FAIL');
    expect(result.checks.functionModuleFormatsCompatible).toBe(false);
    expect(result.checks.functionHandlersLoadable).toBe(false);
    expect(result.functionAudit.bundles.every((bundle) => (
      bundle.module.syntax === 'commonjs'
      && bundle.module.packageType === 'module'
      && bundle.module.smoke.exitCode !== 0
    ))).toBe(true);

    for (const item of handlers) {
      await writeJson(path.join(item.bundle, 'store', 'api', 'package.json'), {
        type: 'commonjs',
      });
    }
    result = await audit(fixture);
    const failedStorePage = result.functionAudit.bundles
      .find((bundle) => bundle.route === '/api/store-page');
    expect(result.status).toBe('FAIL');
    expect(result.checks.functionHandlersLoadable).toBe(true);
    expect(result.checks.functionRuntimeModulesLoadable).toBe(false);
    expect(result.checks.storePageEndToEndSmokePassed).toBe(false);
    expect(failedStorePage.module.smoke).toMatchObject({
      exitCode: 0,
      loaded: true,
      invocable: true,
    });
    expect(failedStorePage.runtimeModules.modules).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'store/generated/storeHtmlTemplate.js',
        syntax: 'commonjs',
        packageType: 'module',
        packageScope: 'package.json',
        requiredPackageScope: 'store/generated/package.json',
        scopeNarrow: false,
        compatible: false,
        smoke: expect.objectContaining({ loaded: false }),
      }),
    ]));
    expect(failedStorePage.requestSmoke).toMatchObject({
      loaded: true,
      invocable: true,
      fetchExists: true,
      requestFinished: true,
      status: 500,
      contentType: 'text/plain; charset=utf-8',
      fallback500Absent: false,
      transitiveTemplateLoaded: false,
      failureReason: 'FINAL_TEMPLATE_FALLBACK_500',
      passed: false,
      externalNetworkDisabled: true,
    });

    const corrected = await applyGeneratedFunctionRuntimeCompatibility(fixture.functionsRoot);
    expect(corrected).toEqual([
      expect.objectContaining({
        route: '/api/og/store',
        packageScope: 'store/api/package.json',
        packageType: 'commonjs',
        atomic: true,
        idempotent: true,
      }),
      expect.objectContaining({
        route: '/api/store-page',
        packageScope: 'store/api/package.json',
        packageType: 'commonjs',
        atomic: true,
        idempotent: true,
      }),
      expect.objectContaining({
        route: '/api/store-page',
        packageScope: 'store/generated/package.json',
        modules: ['store/generated/storeHtmlTemplate.js'],
        packageType: 'commonjs',
        atomic: true,
        created: true,
      }),
    ]);
    for (const item of handlers) {
      expect(JSON.parse(await readFile(path.join(item.bundle, 'store', 'api', 'package.json'), 'utf8')))
        .toEqual({ type: 'commonjs' });
      expect(JSON.parse(await readFile(path.join(item.bundle, '.vc-config.json'), 'utf8')).handler)
        .toBe(item.handler);
    }
    expect(JSON.parse(await readFile(path.join(generatedRoot, 'package.json'), 'utf8')))
      .toEqual({ type: 'commonjs' });
    expect((await readdir(generatedRoot)).some((name) => name.startsWith('.runtime-package-')))
      .toBe(false);
    const repeated = await applyGeneratedFunctionRuntimeCompatibility(fixture.functionsRoot);
    expect(repeated).toHaveLength(3);
    expect(repeated.every((scope) => scope.idempotent && !scope.created)).toBe(true);

    result = await audit(fixture);
    expect(result.status, JSON.stringify(result.failedChecks)).toBe('PASS');
    expect(result.checks.functionHandlersLoadable).toBe(true);
    expect(result.checks.functionHandlersInvocable).toBe(true);
    expect(result.checks.functionRuntimeModulesPresent).toBe(true);
    expect(result.checks.functionRuntimeModuleScopesNarrow).toBe(true);
    expect(result.checks.functionRuntimeModulesLoadable).toBe(true);
    expect(result.checks.functionRequestsCompleted).toBe(true);
    expect(result.checks.storePageEndToEndSmokePassed).toBe(true);
    expect(result.checks.ogEndToEndSmokePassed).toBe(true);
    expect(result.checks.noExternalSmokeRequests).toBe(true);
    expect(result.checks.independentFunctionSmokePassed).toBe(true);
    const correctedStorePage = result.functionAudit.bundles
      .find((bundle) => bundle.route === '/api/store-page');
    expect(correctedStorePage.requestSmoke).toMatchObject({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      html: true,
      fallback500Absent: true,
      doctype: true,
      rootCount: 1,
      transitiveTemplateLoaded: true,
      passed: true,
    });
    const correctedOg = result.functionAudit.bundles
      .find((bundle) => bundle.route === '/api/og/store');
    expect(correctedOg.runtimeModules.modules).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'store/api/_ogRuntime.js',
        syntax: 'commonjs',
        packageScope: 'store/api/package.json',
        scopeNarrow: true,
        compatible: true,
        smoke: expect.objectContaining({ loaded: true }),
      }),
    ]));
    expect(correctedOg.requestSmoke).toMatchObject({
      status: 200,
      contentType: 'image/png',
      png: true,
      passed: true,
    });
  });

  it('rechaza un handler ESM .js bajo type=commonjs antes del deployment', async () => {
    const root = path.join(fixture.functionsRoot, 'api', 'store-page.func');
    await rename(path.join(root, 'index.mjs'), path.join(root, 'index.js'));
    await writeJson(path.join(root, 'package.json'), { type: 'commonjs' });
    await writeJson(path.join(root, '.vc-config.json'), {
      runtime: CURRENT_NODE_RUNTIME,
      handler: 'index.js',
    });
    const result = await audit(fixture);
    const html = result.functionAudit.bundles.find((bundle) => bundle.route === '/api/store-page');
    expect(result.status).toBe('FAIL');
    expect(result.checks.functionModuleFormatsCompatible).toBe(false);
    expect(result.checks.functionHandlersLoadable).toBe(false);
    expect(html.module).toMatchObject({
      syntax: 'module',
      packageType: 'commonjs',
      interpretedAs: 'commonjs',
      compatible: false,
    });
    expect(html.module.smoke.exitCode).not.toBe(0);
  });

  it('acepta el contrato de workspace temporal con store efectivo explícito', () => {
    expect(verifyTemporaryStoreRoot({
      workspaceRoot: fixture.workspaceRoot,
      effectiveStoreRoot: fixture.storeRoot,
    })).toBe(true);
  });

  it('normaliza solamente los bundles de entrada esperados con evidencia', async () => {
    await rename(
      path.join(fixture.functionsRoot, 'api', 'store-page.func'),
      path.join(fixture.functionsRoot, 'api', 'store-page.js.func'),
    );
    await rename(
      path.join(fixture.functionsRoot, 'api', 'og', 'store.func'),
      path.join(fixture.functionsRoot, 'api', 'og', 'store.js.func'),
    );
    const result = await audit(fixture);
    expect(result.status, JSON.stringify(result.failedChecks)).toBe('PASS');
    expect(result.functionAudit.bundles.map((bundle) => [bundle.rawRoute, bundle.route, bundle.normalized]))
      .toEqual(expect.arrayContaining([
        ['/api/store-page.js', '/api/store-page', true],
        ['/api/og/store.js', '/api/og/store', true],
      ]));
  });

  it('rechaza una extensión arbitraria aunque tenga handler y runtime', async () => {
    await rename(
      path.join(fixture.functionsRoot, 'api', 'store-page.func'),
      path.join(fixture.functionsRoot, 'api', 'store-page.ts.func'),
    );
    const result = await audit(fixture);
    expect(result.checks.exactlyExpectedFunctions).toBe(false);
  });

  it('clasifica mapas internos seguros y bloquea mapas públicos o con secretos', async () => {
    await writeFile(
      path.join(fixture.functionsRoot, 'api', 'store-page.func', 'index.mjs.map'),
      JSON.stringify({ version: 3, sources: ['node_modules/react/index.js'], mappings: '' }),
    );
    let result = await audit(fixture);
    expect(result.status, JSON.stringify(result.failedChecks)).toBe('PASS');
    expect(result.functionAudit.bundles.find((bundle) => bundle.route === '/api/store-page')
      .internalFunctionSourceMaps[0]).toMatchObject({ generatedBy: '@vercel/node (inferred)', closureSafe: true });
    await writeFile(path.join(fixture.staticRoot, 'assets', 'index-ZyXw9876.js.map'), '{}');
    result = await audit(fixture);
    expect(result.checks.noPublicSourceMaps).toBe(false);
  });

  it.each([
    ['ruta Windows', { version: 3, sources: ['C:\\workspace\\generated\\entry.js'], mappings: '' }],
    ['file URL', { version: 3, sources: ['file:///workspace/generated/entry.js'], mappings: '' }],
  ])('no trata %s en un sourcemap seguro como import ejecutable', async (_label, sourceMap) => {
    await writeFile(
      path.join(fixture.functionsRoot, 'api', 'og', 'store.func', 'index.mjs.map'),
      JSON.stringify(sourceMap),
    );
    const result = await audit(fixture);
    expect(result.status, JSON.stringify(result.failedChecks)).toBe('PASS');
    expect(result.checks.noBrokenLocalImports).toBe(true);
    expect(result.functionAudit.bundles.find((bundle) => bundle.route === '/api/og/store')
      .internalFunctionSourceMaps[0].closureSafe).toBe(true);
  });

  it.each([
    ['src', 'src/admin.js'],
    ['supabase', 'supabase/functions/private.js'],
  ])('sigue bloqueando un sourcemap que referencia %s', async (_label, reference) => {
    await writeFile(
      path.join(fixture.functionsRoot, 'api', 'og', 'store.func', 'index.mjs.map'),
      JSON.stringify({ version: 3, sources: [reference], mappings: '' }),
    );
    const result = await audit(fixture);
    expect(result.checks.internalFunctionSourceMapsSafe).toBe(false);
    expect(result.checks.noBrokenLocalImports).toBe(true);
  });

  it('sigue bloqueando secretos dentro de un sourcemap', async () => {
    await writeFile(
      path.join(fixture.functionsRoot, 'api', 'og', 'store.func', 'index.mjs.map'),
      JSON.stringify({
        version: 3,
        sources: ['node_modules/@vercel/og/index.js'],
        sourcesContent: ["const GITHUB_TOKEN='ghp_12345678901234567890';"],
        mappings: '',
      }),
    );
    const result = await audit(fixture);
    expect(result.checks.noSecrets).toBe(false);
  });

  it.each([
    ['ruta absoluta Windows', "import value from 'C:\\\\workspace\\\\outside.js';", 'absolute-windows'],
    ['file URL', "import('file:///workspace/outside.js');", 'file-url'],
    ['escape con ../', "const value=require('../outside.js');", 'escapes-bundle'],
  ])('bloquea imports ejecutables con %s', async (_label, source, classification) => {
    await writeFile(path.join(fixture.functionsRoot, 'api', 'og', 'store.func', 'unsafe.mjs'), source);
    const result = await audit(fixture);
    expect(result.checks.noBrokenLocalImports).toBe(false);
    expect(result.functionAudit.safety.localImportViolations).toContainEqual({
      route: '/api/og/store', path: 'unsafe.mjs', classification,
    });
  });

  it('no interpreta texto normal con C:\\ como import ejecutable', async () => {
    await writeFile(
      path.join(fixture.functionsRoot, 'api', 'og', 'store.func', 'message.mjs'),
      "const message = 'Error at C:\\\\workspace\\\\report.txt';",
    );
    const result = await audit(fixture);
    expect(result.checks.noBrokenLocalImports).toBe(true);
  });

  it('enumera fuentes del closure OG y rechaza las no autorizadas', async () => {
    const ogRoot = path.join(fixture.functionsRoot, 'api', 'og', 'store.func');
    await mkdir(path.join(ogRoot, 'node_modules', '@vercel', 'og'), { recursive: true });
    await writeFile(path.join(ogRoot, 'node_modules', '@vercel', 'og', 'package.json'), '{"name":"@vercel/og"}');
    await writeFile(path.join(ogRoot, 'node_modules', '@vercel', 'og', 'noto.woff'), 'font');
    let result = await audit(fixture);
    const og = result.functionAudit.bundles.find((bundle) => bundle.route === '/api/og/store');
    expect(result.status, JSON.stringify(result.failedChecks)).toBe('PASS');
    expect(og.fonts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        relativePath: 'node_modules/@vercel/og/noto.woff',
        extension: '.woff', originPackage: '@vercel/og', insideFunctionBundle: true,
        public: false, referencedFromConfig: false, allowed: true,
      }),
    ]));
    await writeFile(path.join(ogRoot, 'manual.woff2'), 'font');
    result = await audit(fixture);
    expect(result.checks.ogFunctionFontsAllowed).toBe(false);
    expect(result.checks.noFonts).toBe(false);
  });

  it('mantiene las fuentes prohibidas en static y store-page, y bloquea una fuente administrativa', async () => {
    await writeFile(path.join(fixture.staticRoot, 'assets', 'public.woff2'), 'font');
    let result = await audit(fixture);
    expect(result.checks.noPublicFonts).toBe(false);
    expect(result.checks.noFonts).toBe(false);
    await rm(path.join(fixture.staticRoot, 'assets', 'public.woff2'));
    await writeFile(path.join(fixture.functionsRoot, 'api', 'store-page.func', 'private.woff2'), 'font');
    result = await audit(fixture);
    expect(result.checks.htmlFunctionHasNoFonts).toBe(false);
    await rm(path.join(fixture.functionsRoot, 'api', 'store-page.func', 'private.woff2'));
    await mkdir(path.join(fixture.functionsRoot, 'api', 'og', 'store.func', 'src'), { recursive: true });
    await writeFile(path.join(fixture.functionsRoot, 'api', 'og', 'store.func', 'src', 'CajaPage.woff2'), 'CajaPage');
    result = await audit(fixture);
    expect(result.checks.ogFunctionFontsAllowed).toBe(false);
    expect(result.checks.noAdministrativeCode).toBe(false);
  });

  it('emite diagnóstico acotado de fuentes e imports sin rutas absolutas ni contenido', async () => {
    await writeFile(
      path.join(fixture.functionsRoot, 'api', 'og', 'store.func', 'unsafe.mjs'),
      "export { value } from 'C:\\\\Users\\\\private\\\\outside.js';",
    );
    await writeFile(path.join(fixture.functionsRoot, 'api', 'og', 'store.func', 'manual.woff2'), 'font');
    const auditResult = await audit(fixture);
    const diagnostic = sanitizeFailedOutputDiagnostic({ audit: auditResult, usedExplicitBuildsFallback: false });
    expect(diagnostic.functionFonts).toContainEqual({ route: '/api/og/store', paths: ['manual.woff2'] });
    expect(diagnostic.localImportViolations).toContainEqual({ route: '/api/og/store', paths: ['unsafe.mjs'] });
    expect(diagnostic.brokenLocalImports).toContainEqual({
      route: '/api/og/store', path: 'unsafe.mjs', classification: 'absolute-windows',
    });
    expect(diagnostic.localImportClassification).toMatchObject({ 'absolute-windows': 1 });
    expect(JSON.stringify(diagnostic)).not.toContain('C:\\Users\\private');
  });

  it.each([
    ['workspace fuera de TEMP', () => path.join(process.cwd(), 'store'), () => path.join(process.cwd(), 'store', 'store')],
    ['store/store duplicado', () => fixture.workspaceRoot, () => path.join(fixture.workspaceRoot, 'store', 'store')],
  ])('rechaza el contrato temporal: %s', (_label, workspaceRoot, effectiveStoreRoot) => {
    expect(verifyTemporaryStoreRoot({ workspaceRoot: workspaceRoot(), effectiveStoreRoot: effectiveStoreRoot() })).toBe(false);
  });

  it('usa solo código ejecutable para clasificar dependencias y conserva sourcemaps para seguridad', async () => {
    await writeFile(
      path.join(fixture.functionsRoot, 'api', 'store-page.func', 'index.mjs.map'),
      JSON.stringify({ version: 3, sources: ['node_modules/react/index.js'], names: ['@vercel/og'], mappings: '' }),
    );
    const result = await audit(fixture);
    const html = result.functionAudit.bundles.find((bundle) => bundle.route === '/api/store-page');
    const og = result.functionAudit.bundles.find((bundle) => bundle.route === '/api/og/store');
    expect(html.dependencies).toMatchObject({ vercelOg: false, react: false });
    expect(og.dependencies).toMatchObject({ vercelOg: true, react: true });
    expect(html.internalFunctionSourceMaps).toHaveLength(1);
    expect(result.checks.internalFunctionSourceMapsSafe).toBe(true);
  });

  it('acepta vocabulario defensivo sin valores credenciales', async () => {
    const result = await audit(fixture);
    expect(result.status, JSON.stringify(result.failedChecks)).toBe('PASS');
    expect(result.functionAudit.safety.secretViolations).toEqual([]);
    expect(result.functionAudit.safety.credentialVocabulary.defensive).toEqual(
      expect.arrayContaining([
        expect.stringContaining('service_role'),
        expect.stringContaining('SUPABASE_SERVICE_ROLE'),
      ]),
    );
  });

  it('acepta Dexie y copy público de caja en el storefront', async () => {
    const publicCopy = 'const storeDb = Dexie; const copy = "Pago en caja"; const label = "Caja";';
    await Promise.all([
      writeFile(path.join(fixture.staticRoot, 'assets', 'public-copy-AbCd1234.js'), publicCopy),
      writeFile(path.join(fixture.sourceStatic, 'assets', 'public-copy-AbCd1234.js'), publicCopy),
    ]);
    const result = await audit(fixture);
    expect(result.checks.noAdministrativeCode).toBe(true);
    expect(result.staticAudit.safety.administrativeViolations).toEqual([]);
  });

  it('conserva los marcadores administrativos de alta precisión', async () => {
    const administrativeCode = 'const db = LanzoDB; const page = CajaPage; processSale(order);';
    await Promise.all([
      writeFile(path.join(fixture.staticRoot, 'assets', 'administrative-AbCd1234.js'), administrativeCode),
      writeFile(path.join(fixture.sourceStatic, 'assets', 'administrative-AbCd1234.js'), administrativeCode),
    ]);
    const result = await audit(fixture);
    expect(result.checks.noAdministrativeCode).toBe(false);
    expect(result.staticAudit.safety.administrativeViolations).toEqual(expect.arrayContaining([
      'CajaPage:assets/administrative-AbCd1234.js',
      'LanzoDB:assets/administrative-AbCd1234.js',
      'processSale:assets/administrative-AbCd1234.js',
    ]));
  });

  it('clasifica vocabulario OAuth y placeholders sin ocultar valores reales', async () => {
    const defensive = [
      '{ access_token: "access_token" }',
      '{ refresh_token: "refresh_token" }',
      '{ grant_type: "refresh_token" }',
      'const field = "access_token";',
      'const placeholder = "your_access_token";',
    ].join('\n');
    await Promise.all([
      writeFile(path.join(fixture.staticRoot, 'assets', 'oauth-AbCd1234.js'), defensive),
      writeFile(path.join(fixture.sourceStatic, 'assets', 'oauth-AbCd1234.js'), defensive),
    ]);
    const result = await audit(fixture);
    expect(result.checks.noSecrets).toBe(true);
    expect(result.staticAudit.safety.credentialVocabulary.access_token)
      .toContain('assets/oauth-AbCd1234.js');
    expect(result.staticAudit.safety.credentialAssignments).toEqual(expect.arrayContaining([
      expect.objectContaining({
        key: 'access_token', value: '<redacted>', valueLength: 12, classification: 'oauth-vocabulary',
      }),
      expect.objectContaining({ key: 'refresh_token', classification: 'oauth-vocabulary' }),
    ]));
  });

  it('bloquea asignaciones OAuth con apariencia de credencial y no expone su valor', async () => {
    const syntheticToken = 'AbC9_xY7-KlM2_qRs8-TuV4_WxZ6';
    const syntheticRefresh = 'rt_8fK3mN9qT6vX2pL7sC4dH1jA';
    const values = `{ access_token: "${syntheticToken}" }\n{ refresh_token: "${syntheticRefresh}" }`;
    await Promise.all([
      writeFile(path.join(fixture.staticRoot, 'assets', 'credential-AbCd1234.js'), values),
      writeFile(path.join(fixture.sourceStatic, 'assets', 'credential-AbCd1234.js'), values),
    ]);
    const result = await audit(fixture);
    expect(result.checks.noSecrets).toBe(false);
    expect(result.staticAudit.safety.secretViolations).toEqual(expect.arrayContaining([
      `credentialValue:access_token:length=${syntheticToken.length}:assets/credential-AbCd1234.js`,
      `credentialValue:refresh_token:length=${syntheticRefresh.length}:assets/credential-AbCd1234.js`,
    ]));
    expect(JSON.stringify(result.staticAudit.safety)).not.toContain(syntheticToken);
    expect(JSON.stringify(result.staticAudit.safety)).not.toContain(syntheticRefresh);
  });

  it.each([
    ['access_token', 'access_token', 'oauth-vocabulary'],
    ['refresh_token', 'refresh_token', 'oauth-vocabulary'],
    ['access_token', 'your_access_token', 'placeholder'],
    ['access_token', 'AbC9_xY7-KlM2_qRs8-TuV4_WxZ6', 'credential-like'],
  ])('clasifica %s sin depender del nombre de archivo', (key, value, classification) => {
    expect(classifyCredentialAssignment(key, value)).toBe(classification);
  });

  it('requiere static materializado para auditar el Build Output completo', async () => {
    await rm(fixture.staticRoot, { recursive: true });
    await expect(audit(fixture)).rejects.toThrow('Missing prebuilt input: static');
  });

  it.each([
    ['función HTML ausente', async () => rm(
      path.join(fixture.functionsRoot, 'api', 'store-page.func'),
      { recursive: true },
    ), 'exactlyExpectedFunctions'],
    ['función OG ausente', async () => rm(
      path.join(fixture.functionsRoot, 'api', 'og', 'store.func'),
      { recursive: true },
    ), 'exactlyExpectedFunctions'],
    ['tercera función', async () => createFunction(
      fixture.functionsRoot,
      'api/extra',
      'export default {}',
    ), 'exactlyExpectedFunctions'],
    ['helper publicado', async () => createFunction(
      fixture.functionsRoot,
      'api/_publicPortal',
      'export default {}',
    ), 'exactlyExpectedFunctions'],
    ['asset administrativo', async () => writeFile(
      path.join(fixture.staticRoot, 'assets', 'Dashboard-AbCd1234.js'),
      'const Dashboard=true;',
    ), 'noAdministrativeCode'],
    ['secreto', async () => writeFile(
      path.join(fixture.functionsRoot, 'api', 'store-page.func', 'secret.js'),
      "const GITHUB_TOKEN='ghp_12345678901234567890';",
    ), 'noSecrets'],
    ['asignación service role', async () => writeFile(
      path.join(fixture.functionsRoot, 'api', 'store-page.func', 'secret.js'),
      "const role='service_role';",
    ), 'noSecrets'],
    ['clave Supabase secreta', async () => writeFile(
      path.join(fixture.functionsRoot, 'api', 'store-page.func', 'secret.js'),
      "const serviceRoleKey='sb_secret_real_example_123456';",
    ), 'noSecrets'],
    ['token Vercel sintético', async () => writeFile(
      path.join(fixture.functionsRoot, 'api', 'store-page.func', 'secret.js'),
      "const token='vcp_1234567890abcdefghijklmnopqrst';",
    ), 'noSecrets'],
    ['clave privada sintética', async () => writeFile(
      path.join(fixture.functionsRoot, 'api', 'store-page.func', 'secret.js'),
      '-----BEGIN PRIVATE KEY-----\nfixture\n-----END PRIVATE KEY-----',
    ), 'noSecrets'],
    ['variable Supabase service role', async () => writeFile(
      path.join(fixture.functionsRoot, 'api', 'store-page.func', 'secret.js'),
      "const SUPABASE_SERVICE_ROLE='secret-value-example';",
    ), 'noSecrets'],
    ['archivo env con service role', async () => writeFile(
      path.join(fixture.functionsRoot, 'api', 'store-page.func', 'secret.js'),
      'SUPABASE_SERVICE_ROLE=secret-value-example',
    ), 'noSecrets'],
    ['JWT service role', async () => writeFile(
      path.join(fixture.functionsRoot, 'api', 'store-page.func', 'secret.js'),
      `headers.authorization='Bearer ${PRIVILEGED_JWT}';`,
    ), 'noSecrets'],
    ['template ausente', async () => writeFile(
      path.join(fixture.functionsRoot, 'api', 'store-page.func', 'index.mjs'),
      'export default {}',
    ), 'htmlResolvesTemplate'],
    ['tracking incorrecto', async () => {
      const configPath = path.join(fixture.outputRoot, 'config.json');
      const config = JSON.parse(await readFile(configPath, 'utf8'));
      config.routes[5].dest = '/api/store-page?slug=$1&tracking=$2';
      await writeJson(configPath, config);
    }, 'trackingStatic'],
    ['HTML immutable', async () => {
      const configPath = path.join(fixture.outputRoot, 'config.json');
      const config = JSON.parse(await readFile(configPath, 'utf8'));
      config.routes[3].headers['Cache-Control'] = 'public, max-age=31536000, immutable';
      await writeJson(configPath, config);
    }, 'htmlNeverImmutable'],
    ['asset sin caché', async () => {
      const configPath = path.join(fixture.outputRoot, 'config.json');
      const config = JSON.parse(await readFile(configPath, 'utf8'));
      config.routes.splice(2, 1);
      await writeJson(configPath, config);
    }, 'immutableAssets'],
    ['loop', async () => {
      const configPath = path.join(fixture.outputRoot, 'config.json');
      const config = JSON.parse(await readFile(configPath, 'utf8'));
      config.routes.splice(-1, 0, { src: '/loop', dest: '/loop' });
      await writeJson(configPath, config);
    }, 'noRouteLoop'],
    ['source map público', async () => writeFile(
      path.join(fixture.staticRoot, 'assets', 'index.mjs.map'),
      '{}',
    ), 'noPublicSourceMaps'],
    ['fuente', async () => writeFile(
      path.join(fixture.functionsRoot, 'api', 'og', 'store.func', 'custom.woff2'),
      'font',
    ), 'noFonts'],
  ])('rechaza %s', async (_label, mutate, failedCheck) => {
    await mutate();
    const result = await audit(fixture);
    expect(result.status).toBe('FAIL');
    expect(result.checks[failedCheck]).toBe(false);
  });
});
