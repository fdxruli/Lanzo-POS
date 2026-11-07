// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ updateCompanyProfile: vi.fn() }));

vi.mock('../../../store/useAppStore', () => ({
  useAppStore: (selector) => selector({
    companyProfile: { name: 'Shop', business_type: ['hardware'] },
    updateCompanyProfile: mocks.updateCompanyProfile
  })
}));

vi.mock('../../../services/auth/useSettingsAccess', () => ({
  useSettingsAccess: () => ({ canAccessSection: () => false }),
  useSettingsActionGuard: () => () => { throw new Error('PERMISSION_DENIED'); }
}));

vi.mock('../../common/NoPermission', () => ({
  default: () => <div role="alert">No tienes acceso</div>
}));

import GeneralSettings from '../GeneralSettings';

describe('GeneralSettings direct mount protection', () => {
  afterEach(cleanup);

  it('does not mount profile or appearance controls without Datos y Apariencia', () => {
    render(<GeneralSettings />);

    expect(screen.getByRole('alert')).toHaveTextContent('No tienes acceso');
    expect(screen.queryByRole('heading', { name: 'Identidad del negocio' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Guardar datos' })).not.toBeInTheDocument();
  });
});
