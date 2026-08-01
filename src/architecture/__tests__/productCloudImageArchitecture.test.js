// @vitest-environment node
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const projectRoot = fileURLToPath(new URL('../../../', import.meta.url));
const readProjectFile = (relativePath) => readFile(path.join(projectRoot, relativePath), 'utf8');

describe('product cloud image architecture', () => {
  it('uploads a selected product file before persisting the product cloud payload', async () => {
    const page = await readProjectFile('src/pages/ProductsPage.jsx');
    const uploadIndex = page.indexOf('await uploadProductImage(selectedImage, licenseKey)');
    const saveIndex = page.indexOf('await productRepository.saveProduct(productPayload');

    expect(page).toContain("from '../services/storage/imageUploadService'");
    expect(page).toContain('isCloudProductsSyncEnabled(licenseDetails)');
    expect(page).toContain('imageUrl: uploadedImage.publicUrl');
    expect(page).toContain('images_cloud: true');
    expect(uploadIndex).toBeGreaterThan(0);
    expect(saveIndex).toBeGreaterThan(uploadIndex);
  });

  it('preserves the previous public URL when an edit does not select another file', async () => {
    const page = await readProjectFile('src/pages/ProductsPage.jsx');

    expect(page).toMatch(/const existingImageUrl = productData\.imageUrl[\s\S]*productToEdit\.imageUrl/);
    expect(page).toMatch(/const existingImageRef = productData\.imageRef[\s\S]*productToEdit\.imageRef/);
    expect(page).toContain('imageUrl: existingImageUrl');
    expect(page).toContain('imageRef: existingImageRef');
  });

  it('maps the public URL through POS sync and ecommerce catalog projection', async () => {
    const [mapper, catalogSync] = await Promise.all([
      readProjectFile('src/services/products/productMapper.js'),
      readProjectFile('src/services/ecommerce/ecommerceCatalogSyncServiceBase.js')
    ]);

    expect(mapper).toMatch(/image_url:\s*optionalText\(product\.imageUrl\)/);
    expect(mapper).toMatch(/imageUrl:\s*product\.image_url\s*\|\|\s*product\.imageUrl/);
    expect(catalogSync).toMatch(/product\.imageUrl\s*\|\|\s*product\.image_url\s*\|\|\s*product\.image/);
    expect(catalogSync).toContain('fields.image = getPublicImage(localProduct)');
  });
});
