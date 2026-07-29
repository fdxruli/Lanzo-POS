import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  auditStoreServerImports,
  verifyTemplateSynchronization,
} from '../../../scripts/build-store-vercel.mjs';
import { serializeStoreHtmlTemplateModule } from '../../../scripts/generate-store-html-template.mjs';
import {
  normalizeEcommercePortalTemplate,
  normalizeEcommercePortalTheme,
} from '../../../src/utils/ecommercePortalTheme.js';
import {
  normalizePublicPortalTemplate,
  normalizePublicPortalTheme,
} from '../../api/_portalTheme.js';

const projectRoot = fileURLToPath(new URL('../../../', import.meta.url));
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const htmlFixture = `<!doctype html>
<html><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width">
<!-- LANZO_SOCIAL_HEAD_START -->
<title>Tienda en línea | Lanzo</title>
<meta name="description" content="Tienda">
<!-- LANZO_SOCIAL_HEAD_END -->
<link rel="stylesheet" href="/assets/index-AbCd1234.css">
</head><body><div id="root"></div>
<script type="module" src="/assets/index-ZyXw9876.js"></script></body></html>`;

describe('integración del build social', () => {
  it('mantiene paridad con todos los valores admitidos del tema administrativo', () => {
    for (const template of ['classic', 'showcase', 'compact', 'otro', null]) {
      expect(normalizePublicPortalTemplate(template))
        .toBe(normalizeEcommercePortalTemplate(template));
    }
    for (const primaryColor of ['#AABBCC', '#000000', '#fffffe', 'red', null]) {
      for (const secondaryColor of ['#112233', '#FFFFFF', 'invalid', undefined]) {
        for (const cornerStyle of ['rounded', 'soft', 'square', 'invalid']) {
          for (const fontStyle of ['system', 'rounded', 'editorial', 'invalid']) {
            const theme = { primaryColor, secondaryColor, cornerStyle, fontStyle };
            expect(normalizePublicPortalTheme(theme))
              .toEqual(normalizeEcommercePortalTheme(theme));
          }
        }
      }
    }
  });

  it('mantiene fuente, módulo generado y HTML staged byte a byte', async () => {
    const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'lanzo-template-sync-'));
    const sourcePath = path.join(temporaryRoot, 'dist-store', 'index.html');
    const generatedPath = path.join(temporaryRoot, 'store', 'generated', 'storeHtmlTemplate.js');
    const stagedPath = path.join(temporaryRoot, 'store', 'dist', 'index.html');
    await Promise.all([
      mkdir(path.dirname(sourcePath), { recursive: true }),
      mkdir(path.dirname(generatedPath), { recursive: true }),
      mkdir(path.join(path.dirname(stagedPath), 'assets'), { recursive: true }),
    ]);
    await Promise.all([
      writeFile(sourcePath, htmlFixture),
      writeFile(generatedPath, serializeStoreHtmlTemplateModule(htmlFixture)),
      writeFile(stagedPath, htmlFixture),
      writeFile(path.join(path.dirname(stagedPath), 'assets', 'index-AbCd1234.css'), 'body{}'),
      writeFile(path.join(path.dirname(stagedPath), 'assets', 'index-ZyXw9876.js'), 'export{}'),
    ]);
    const result = await verifyTemplateSynchronization({
      sourceHtmlPath: sourcePath,
      generatedModulePath: generatedPath,
      stagedHtmlPath: stagedPath,
    });
    expect(result.hashes).toEqual({
      source: sha256(htmlFixture),
      template: sha256(htmlFixture),
      staged: sha256(htmlFixture),
    });
    expect(result.bytes.source).toBe(Buffer.byteLength(htmlFixture));
  });

  it('descubre solo dos endpoints y ninguna importación sale de store', async () => {
    const result = await auditStoreServerImports(projectRoot);
    expect(result.publicFunctions).toEqual(['/api/og/store', '/api/store-page']);
    expect(result.dependencyClosure['/api/og/store'].packages)
      .toEqual(['@vercel/og', 'react']);
    expect(result.dependencyClosure['/api/store-page'].packages).not.toContain('@vercel/og');
    for (const closure of Object.values(result.dependencyClosure)) {
      expect(closure.files.every((file) => file.startsWith('api/'))).toBe(true);
    }
  });
});
