// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import CashSessionAgeAttention from '../CashSessionAgeAttention';

afterEach(cleanup);

describe('CashSessionAgeAttention', () => {
  it('shows one grouped incident and preserves the higher three day classification', () => {
    const onReview = vi.fn();
    render(
      <CashSessionAgeAttention
        attention={{ status: 'success', pendingCount: 2, reviewCount: 1 }}
        onReview={onReview}
      />
    );

    expect(screen.getByRole('heading', {
      name: 'Tienes 2 cajas abiertas que requieren revisión'
    })).toBeInTheDocument();
    expect(screen.getByText(/1 caja lleva 3 días o más abierta y requiere atención prioritaria/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Revisar cajas' }));
    expect(onReview).toHaveBeenCalledTimes(1);
  });

  it('shows an unavailable state without claiming there are zero sessions', () => {
    render(
      <CashSessionAgeAttention
        attention={{ status: 'unavailable', pendingCount: 0 }}
      />
    );

    expect(screen.getByRole('heading', {
      name: 'Consulta de cajas no disponible'
    })).toBeInTheDocument();
    expect(screen.getByText(/No se pudo confirmar el estado de las cajas/)).toBeInTheDocument();
    expect(screen.queryByText(/Tienes 0 cajas/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Revisar cajas' })).not.toBeInTheDocument();
  });
});
