// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AuditModal from '../AuditModal';

afterEach(cleanup);

describe('AuditModal owner close terminology', () => {
  it('presents the normal owner workflow as a Corte de caja', async () => {
    render(
      <AuditModal
        show
        onClose={vi.fn()}
        onConfirmAudit={vi.fn()}
        caja={{ id: 'cash-own' }}
        calcularTeorico={vi.fn().mockResolvedValue('100')}
      />
    );

    expect(screen.getByRole('heading', { name: 'Corte de caja' })).toBeVisible();
    expect(screen.queryByText(/auditoría administrativa/i)).not.toBeInTheDocument();
  });
});
