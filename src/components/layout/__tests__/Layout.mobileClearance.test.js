import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const readSource = (relativeUrl) => readFileSync(new URL(relativeUrl, import.meta.url), 'utf8');

const indexStyles = readSource('../../../index.css');
const layoutStyles = readSource('../Layout.css');
const navbarStyles = readSource('../Navbar.css');
const shellStyles = readSource('../../../styles/ui-shell.css');
const settingsStyles = readSource('../../../pages/SettingsPage.css');

describe('mobile bottom navigation clearance contract', () => {
  it('defines one safe-area-aware token shared by the nav and layout authorities', () => {
    expect(indexStyles).toContain('--mobile-bottom-nav-height: 65px;');
    expect(indexStyles).toMatch(
      /--mobile-navigation-clearance:\s*calc\([\s\S]*var\(--mobile-bottom-nav-height\)[\s\S]*var\(--safe-area-bottom\)[\s\S]*var\(--spacing-lg\)[\s\S]*\);/
    );
    expect(navbarStyles).toContain(
      'height: calc(var(--mobile-bottom-nav-height) + var(--safe-area-bottom));'
    );
    expect(layoutStyles).toContain('padding-bottom: var(--mobile-navigation-clearance);');
    expect(shellStyles).toContain('padding-bottom: var(--mobile-navigation-clearance);');
  });

  it('transfers direct ui-page clearance without changing POS or desktop spacing', () => {
    expect(layoutStyles).toMatch(
      /\.page-container:has\(> \.ui-page\)\s*{\s*padding-bottom:\s*0;/
    );
    expect(layoutStyles).toMatch(/\.page-container-pos\s*{[\s\S]*padding-bottom:\s*0;/);
    expect(shellStyles).toMatch(
      /@media \(min-width: 1024px\)\s*{\s*\.ui-page\s*{\s*padding-bottom:\s*var\(--ui-space-lg\);/
    );
  });

  it('keeps all six ui-page roots on the shared contract without Settings workarounds', () => {
    const pagesDirectory = new URL('../../../pages/', import.meta.url);
    const uiPageRoots = readdirSync(pagesDirectory)
      .filter((fileName) => fileName.endsWith('.jsx'))
      .filter((fileName) => readSource(`../../../pages/${fileName}`).includes('className="ui-page '))
      .sort();

    expect(uiPageRoots).toEqual([
      'CajaPage.jsx',
      'CustomersPage.jsx',
      'DashboardPage.jsx',
      'EcommercePortalPage.jsx',
      'ProductsPage.jsx',
      'SettingsPage.jsx',
    ]);
    expect(settingsStyles).not.toMatch(/padding-bottom:\s*(?:120px|calc\((?:96|104|120)px)/);
  });
});
