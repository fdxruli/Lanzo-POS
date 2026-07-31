import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  generateStoreHtmlTemplate,
  serializeStoreHtmlTemplateModule,
} from '../../../scripts/generate-store-html-template.mjs';
import {
  StoreHtmlTemplateError,
  injectSocialHead,
  validateStoreHtmlTemplate,
} from '../../api/_storeHtmlTemplate.js';
import { STORE_HTML_FIXTURE } from './fixtures/storeHtmlFixture.js';

const replaceOnce = (source, value, replacement = '') => source.replace(value, replacement);

describe('integridad de la plantilla HTML', () => {
  it('acepta HTML Vite completo y conserva SPA y assets literalmente', () => {
    expect(validateStoreHtmlTemplate(STORE_HTML_FIXTURE).valid).toBe(true);
    const injected = injectSocialHead(STORE_HTML_FIXTURE, '<title>Personalizada</title>');
    [
      'id="root"',
      'type="module"',
      'rel="stylesheet"',
      'rel="modulepreload"',
      '/assets/index-AbCd1234.js',
      '/assets/index-Css12345.css',
    ].forEach((value) => expect(injected).toContain(value));
    expect(injected).toContain('<title>Personalizada</title>');
    expect(injected).not.toContain('<title>Tienda en línea | Lanzo</title>');
  });

  it.each([
    [
      replaceOnce(STORE_HTML_FIXTURE, '<!-- LANZO_SOCIAL_HEAD_START -->'),
      'marcador ausente',
    ],
    [
      STORE_HTML_FIXTURE.replace(
        '<!-- LANZO_SOCIAL_HEAD_START -->',
        '<!-- LANZO_SOCIAL_HEAD_START --><!-- LANZO_SOCIAL_HEAD_START -->',
      ),
      'marcador duplicado',
    ],
    [replaceOnce(STORE_HTML_FIXTURE, 'id="root"', 'id="other"'), '#root ausente'],
    [replaceOnce(STORE_HTML_FIXTURE, '<!doctype html>'), 'doctype ausente'],
    [
      STORE_HTML_FIXTURE.replaceAll(/<(?:script|link)[^>]+\/assets\/[^>]+>(?:<\/script>)?/gu, ''),
      'assets ausentes',
    ],
  ])('rechaza estado ambiguo: %s', (html) => {
    expect(() => validateStoreHtmlTemplate(html)).toThrow(StoreHtmlTemplateError);
  });

  it('rechaza metadata social previa fuera del bloque controlado', () => {
    const duplicated = STORE_HTML_FIXTURE.replace(
      '</head>',
      '<title>Duplicado</title></head>',
    );
    expect(() => validateStoreHtmlTemplate(duplicated)).toThrow(StoreHtmlTemplateError);
  });
});

describe('generador ESM', () => {
  it('serializa Unicode, backticks y ${} como un módulo importable', async () => {
    const html = STORE_HTML_FIXTURE.replace(
      '<body>',
      '<body data-text="Árbol ` ${valor}">',
    );
    const source = serializeStoreHtmlTemplateModule(html);
    expect(source).toContain('Do not edit manually');
    expect(source).not.toContain('sourceMappingURL');
    const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
    const generated = await import(moduleUrl);
    expect(generated.STORE_HTML_TEMPLATE).toBe(html);
  });

  it('escribe atómicamente sin dejar archivos temporales ni paths locales', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'lanzo-store-template-'));
    const inputPath = path.join(directory, 'index.html');
    const outputPath = path.join(directory, 'generated', 'storeHtmlTemplate.js');
    await writeFile(inputPath, STORE_HTML_FIXTURE, 'utf8');
    await generateStoreHtmlTemplate({ inputPath, outputPath });
    const source = await readFile(outputPath, 'utf8');
    const entries = await readdir(path.dirname(outputPath));
    expect(entries).toEqual(['storeHtmlTemplate.js']);
    expect(source).not.toContain(directory);
    const generated = await import(`${pathToFileURL(outputPath).href}?test=1`);
    expect(generated.STORE_HTML_TEMPLATE).toBe(STORE_HTML_FIXTURE);
  });

  it('rechaza UTF-8 inválido y no publica salida parcial', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'lanzo-store-utf8-'));
    const inputPath = path.join(directory, 'index.html');
    const outputPath = path.join(directory, 'generated.js');
    await writeFile(inputPath, new Uint8Array([0xc3, 0x28]));
    await expect(generateStoreHtmlTemplate({ inputPath, outputPath }))
      .rejects.toThrow(/UTF-8/u);
  });

  it.each([
    [STORE_HTML_FIXTURE.replace('</head>', '<!--# sourceMappingURL=/tmp/private.map --></head>'), 'source map'],
    [STORE_HTML_FIXTURE.replace('</head>', '<meta content="SUPABASE_PRIVATE_KEY"></head>'), 'secreto'],
  ])('rechaza %s', (html) => {
    expect(() => serializeStoreHtmlTemplateModule(html)).toThrow();
  });
});
