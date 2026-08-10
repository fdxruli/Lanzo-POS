// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../store/useAppStore', () => ({
  useAppStore: (selector) => selector({
    companyProfile: { business_type: 'abarrotes' },
    licenseDetails: { valid: true }
  })
}));

import ProductForm from '../ProductForm';

afterEach(cleanup);

describe('ProductForm', () => {
  it('renders the canonical V2 product form through the stable page contract', () => {
    render(<ProductForm categories={[]} onSave={vi.fn()} onCancel={vi.fn()} />);

    expect(screen.getByRole('heading', { name: /Nuevo producto/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/Nombre del producto/i)).toBeInTheDocument();
  });
});
