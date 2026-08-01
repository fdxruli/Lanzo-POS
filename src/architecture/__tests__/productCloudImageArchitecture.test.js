// @vitest-environment node
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const projectRoot = fileURLToPath(new URL('../../../', import.meta.url));
const readProjectFile = (relativePath) => readFile(path.join(projectRoot, relativePath), 'utf8');

describe('product cloud image architecture', () => {
  it('keeps a lightweight local thumbnail and a transient original upload source', async () => {
    const commonHook = await readProjectFile('src/hooks/useProductCommon.js');

    expect(commonHook).toContain('const [imageUploadSource, setImageUploadSource] = useState(null)');
    expect(commonHook).toContain('const compressedFile = await compressImage(file)');
    expect(commonHook).toContain('setImageData(compressedFile)');
    expect(commonHook).toContain('setImageUploadSource(file)');
    expect(commonHook).toMatch(/image:\s*imageData,[\s\S]*imageUploadSource/);
  });

  it('routes product saves through the reusable cloud image preparation service', async () => {
    const page = await readProjectFile('src/pages/ProductsPage.jsx');
    const prepareIndex = page.indexOf('await prepareProductImageForCloud({');
    const saveIndex = page.indexOf('await productRepository.saveProduct(productPayload');

    expect(page).toContain("from '../services/products/productImageMigrationService'");
    expect(page).toContain('cloudEnabled: cloudProductImagesEnabled');
    expect(page).toContain('const productPayload = imagePreparation.productPayload');
    expect(prepareIndex).toBeGreaterThan(0);
    expect(saveIndex).toBeGreaterThan(prepareIndex);
  });

  it('automatically migrates legacy img-* blobs from IndexedDB in bounded batches', async () => {
    const [page, migrationService] = await Promise.all([
      readProjectFile('src/pages/ProductsPage.jsx'),
      readProjectFile('src/services/products/productImageMigrationService.js')
    ]);

    expect(page).toContain('migrateLegacyProductImages({');
    expect(page).toContain('limit: 25');
    expect(migrationService).toContain('db.table(STORES.IMAGES).get(imageRef)');
    expect(migrationService).toContain('db.table(STORES.MENU)');
    expect(migrationService).toContain("migrationSource = uploadSource ? 'indexeddb_legacy_blob' : null");
    expect(migrationService).toContain('requiresReselection: Boolean(existingImageRef)');
    expect(migrationService).toContain('await saveProduct(prepared.productPayload, product)');
    expect(migrationService).toContain('summary.hasMore = candidatePool.length > safeLimit');
  });

  it('preserves public URLs and derives truthful cloud image metadata in POS sync', async () => {
    const mapper = await readProjectFile('src/services/products/productMapper.js');

    expect(mapper).toContain('const imageUrl = resolveProductImageUrl(product)');
    expect(mapper).toContain('const imageRef = resolveProductImageRef(product)');
    expect(mapper).toContain('image_url: imageUrl');
    expect(mapper).toContain('image_ref: imageRef');
    expect(mapper).toContain("? 'cloud_public_url'");
    expect(mapper).toContain("(imageRef ? 'local_reference_only' : 'none')");
  });

  it('projects the public URL into the ecommerce catalog', async () => {
    const catalogSync = await readProjectFile('src/services/ecommerce/ecommerceCatalogSyncServiceBase.js');

    expect(catalogSync).toMatch(/product\.imageUrl\s*\|\|\s*product\.image_url\s*\|\|\s*product\.image/);
    expect(catalogSync).toContain('fields.image = getPublicImage(localProduct)');
  });
});
