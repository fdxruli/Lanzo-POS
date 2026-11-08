// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import LicenseContextSummary from '../LicenseContextSummary';

afterEach(cleanup);

describe('LicenseContextSummary', () => {
  it('shows a non-secret license id and never renders the activation key', () => {
    const licenseKey = 'LANZO-1111-2222-3333-4444';
    const licenseId = '11111111-2222-4333-8444-555555555555';
    const { container } = render(
      <LicenseContextSummary
        licenseKey={licenseKey}
        licenseDetails={{ license_key: licenseKey, license_id: licenseId }}
      />
    );

    expect(screen.getByText(`Licencia ${licenseId}`)).toBeInTheDocument();
    expect(container.innerHTML).not.toContain(licenseKey);
    expect(container.querySelector('[title]')).toBeNull();
    expect(container.querySelector('[aria-label]')).toBeNull();
    expect(container.querySelector('.auth-license-context__status svg')).toBeInTheDocument();
  });

  it('uses a protected fallback when the license id is unavailable', () => {
    const licenseKey = 'LEGACY-ACTIVATION-CREDENTIAL';
    const { container } = render(<LicenseContextSummary licenseKey={licenseKey} />);

    expect(screen.getByText('Licencia protegida')).toBeInTheDocument();
    expect(container.innerHTML).not.toContain(licenseKey);
  });

  it('shows only a grouped hint for a standard key when no safe id is available', () => {
    const licenseKey = 'LANZO-1111-2222-3333-4444';
    const { container } = render(<LicenseContextSummary licenseKey={licenseKey} />);

    expect(screen.getByText('Licencia LANZO ···· 4444')).toBeInTheDocument();
    expect(container.innerHTML).not.toContain(licenseKey);
  });

  it('reports a pending license without a key', () => {
    render(<LicenseContextSummary />);

    expect(screen.getByText('Licencia pendiente')).toBeInTheDocument();
  });

  it('keeps business, product and plan as separate responsive text values', () => {
    const { container } = render(
      <LicenseContextSummary
        licenseKey="legacy-key"
        businessName="Mercado Central con nombre largo"
        showBusiness
        licenseDetails={{ product_name: 'Lanzo POS', plan_name: 'Plan Pro' }}
      />
    );

    expect(container.querySelector('.auth-license-context__primary')).toHaveTextContent(
      'Mercado Central con nombre largo'
    );
    expect(container.querySelector('.auth-license-context__plan')).toHaveTextContent('Plan Pro');
    expect(container.querySelector('.auth-license-context__separator')).toHaveTextContent('·');
    expect(container.querySelector('.auth-license-context__meta')).toBeInTheDocument();
  });
});
