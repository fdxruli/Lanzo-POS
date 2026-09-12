import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const generalSettingsSource = readFileSync(
  new URL('../EcommercePortalGeneralSettings.jsx', import.meta.url),
  'utf8'
);
const generalSettingsCss = readFileSync(
  new URL('../EcommercePortalGeneralSettings.css', import.meta.url),
  'utf8'
);

describe('EcommercePortalGeneralSettings authoritative source invariants', () => {
  it('does not read plan capabilities from local license state', () => {
    expect(generalSettingsSource).not.toContain('useAppStore');
    expect(generalSettingsSource).not.toContain('licenseDetails');
    expect(generalSettingsSource).toContain("features?.[camelKey] ?? features?.[snakeKey]");
    expect(generalSettingsSource).toContain('customSlugAllowed: customSlugFeature === true');
  });

  it('does not hide legacy Free general controls with CSS', () => {
    expect(generalSettingsCss).not.toContain(
      '#ecom-portal-panel-design + form.ecom-admin-form-card > .ecom-admin-form-grid'
    );
    expect(generalSettingsCss).not.toContain(
      '#ecom-portal-panel-design + form.ecom-admin-form-card > .ecom-admin-card-heading p'
    );
  });
});
