import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

const listSourceFiles = (directory) => fs.readdirSync(directory, { withFileTypes: true })
  .flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return listSourceFiles(absolute);
    return /\.[cm]?[jt]sx?$/.test(entry.name) ? [absolute] : [];
  });

const read = (file) => fs.readFileSync(file, 'utf8');

describe('catalog store architecture boundaries', () => {
  it('prevents POS modules from importing inventory or the legacy alias', () => {
    const posFiles = [
      path.join(root, 'src/pages/PosPage.jsx'),
      ...listSourceFiles(path.join(root, 'src/hooks/pos')),
      ...listSourceFiles(path.join(root, 'src/components/pos'))
    ];

    for (const file of posFiles) {
      const source = read(file);
      expect(source, path.relative(root, file)).not.toMatch(
        /(?:from\s+|import\s*\()\s*['"][^'"]*(?:useProductStore|useInventoryCatalogStore)['"]/
      );
    }
  });

  it('keeps the visual stores independent and away from Supabase', () => {
    const inventorySource = read(path.join(root, 'src/store/useInventoryCatalogStore.js'));
    const posSource = read(path.join(root, 'src/store/usePosCatalogStore.js'));

    expect(inventorySource).not.toMatch(/usePosCatalogStore/);
    expect(posSource).not.toMatch(/useInventoryCatalogStore|supabase/i);
    expect(inventorySource).not.toMatch(/supabase/i);
  });
});
