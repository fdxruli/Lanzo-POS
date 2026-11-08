// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  hasLayaway: false,
  onAbonar: vi.fn()
}));

vi.mock('../../../hooks/useFeatureConfig', () => ({
  useFeatureConfig: () => ({ hasLayaway: mocks.hasLayaway })
}));
vi.mock('../CustomerReminderActions', () => ({ default: () => null }));

import CustomerCard from '../CustomerCard';

describe('CustomerCard abono permission', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('keeps the debt visible and disables Abonar with a clear explanation', () => {
    render(
      <CustomerCard
        customer={{ id: 'customer-1', name: 'Ana', debt: 25 }}
        canRegisterAbonos={false}
        onAbonar={mocks.onAbonar}
      />
    );

    const abonarButton = screen.getByRole('button', { name: 'Abonar' });
    expect(screen.getByText('$25.00')).toBeInTheDocument();
    expect(abonarButton).toBeDisabled();
    expect(screen.getByText('Sin autorización para registrar abonos.')).toBeInTheDocument();
    expect(abonarButton).toHaveAttribute('aria-describedby', 'customer-abono-permission-customer-1');

    fireEvent.click(abonarButton);
    expect(mocks.onAbonar).not.toHaveBeenCalled();
  });
});
