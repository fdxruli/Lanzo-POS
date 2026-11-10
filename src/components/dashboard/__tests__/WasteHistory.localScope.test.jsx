// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WasteHistory from '../WasteHistory';

afterEach(cleanup);

const record = {
  id: 'merma-1',
  productName: 'Tomate',
  quantity: 2,
  unit: 'kg',
  lossAmount: 31.5,
  reason: 'Dañado',
  timestamp: '2026-11-09T12:00:00.000Z'
};

describe('Mermas: presentación del alcance', () => {
  it('presenta únicamente totales de la página y el origen local, no un total Cloud', () => {
    const onNext = vi.fn();
    render(<WasteHistory
      logs={[record]}
      wasteLoaded
      hasMoreWaste
      onNext={onNext}
      currentWastePageIndex={0}
    />);
    expect(screen.getByText('-$31.50')).toBeInTheDocument();
    expect(screen.getByText('1 registro en esta página')).toBeInTheDocument();
    expect(screen.getByText('Pérdida en esta página')).toBeInTheDocument();
    expect(screen.getByRole('note')).toHaveTextContent('Origen: almacenamiento de este dispositivo');
    expect(screen.getByRole('note')).toHaveTextContent('Hay más registros locales');
    fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }));
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it('no interpreta una consulta pendiente como cero mermas', () => {
    render(<WasteHistory logs={[]} isWasteLoading />);
    expect(screen.getByRole('status')).toHaveTextContent('Cargando mermas');
    expect(screen.queryByText('Sin mermas registradas')).not.toBeInTheDocument();
    expect(screen.getByText('Pérdida en esta página').nextElementSibling).toHaveTextContent('—');
  });

  it('separa errores de la ausencia confirmada de registros', () => {
    const onRetry = vi.fn();
    const { rerender } = render(<WasteHistory
      logs={[]}
      wasteLoaded={false}
      wasteError="No se pudo consultar el historial."
      onRetry={onRetry}
    />);
    expect(screen.getByRole('alert')).toHaveTextContent('No se pudo consultar');
    expect(screen.queryByText('Sin mermas registradas')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(onRetry).toHaveBeenCalledOnce();

    rerender(<WasteHistory logs={[]} wasteLoaded hasMoreWaste={false} />);
    expect(screen.getByText('Sin mermas registradas')).toBeInTheDocument();
    expect(screen.getByRole('note')).toHaveTextContent('no confirma el historial completo');
  });
});