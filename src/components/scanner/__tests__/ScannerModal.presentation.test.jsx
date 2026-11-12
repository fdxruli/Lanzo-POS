// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ScannerCartList } from '../ScannerCartList';
import { UnknownCodesBanner } from '../UnknownCodesBanner';
import { CameraViewport } from '../CameraViewport';

afterEach(cleanup);

describe('Scanner POS presentation', () => {
  it('shows unit prices and subtotals for distinct lines without changing quantity callbacks', () => {
    const add = vi.fn();
    const remove = vi.fn();
    const product = {
      id: 'same-product',
      name: 'Producto con nombre comercial completo, presentación especial y contenido largo',
      price: 62.5,
    };
    render(
      <ScannerCartList
        items={[
          { ...product, batchId: 'batch-1', uniqueLineId: 'line-1', quantity: 3 },
          { ...product, batchId: 'batch-2', uniqueLineId: 'line-2', quantity: 1 },
        ]}
        isConfirming={false}
        onAddQuantity={add}
        onRemoveQuantity={remove}
      />
    );

    const rows = document.querySelectorAll('.scanned-item');
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText('$62.50 c/u')).toBeInTheDocument();
    expect(within(rows[0]).getByText('$187.50')).toBeInTheDocument();
    expect(within(rows[1]).getByText('$62.50')).toBeInTheDocument();
    fireEvent.click(within(rows[0]).getByRole('button', { name: /Disminuir cantidad/ }));
    expect(remove).toHaveBeenCalledWith('line-1', 'batch-1');
    fireEvent.click(within(rows[1]).getByRole('button', { name: /Eliminar cantidad/ }));
    expect(remove).toHaveBeenCalledWith('line-2', 'batch-2');
    fireEvent.click(within(rows[0]).getByRole('button', { name: /Aumentar cantidad/ }));
    expect(add).toHaveBeenCalledWith(expect.objectContaining({ batchId: 'batch-1', quantity: 3 }));
  });

  it('keeps an understandable empty state and a collapsed incident summary', () => {
    const onClear = vi.fn();
    render(
      <>
        <ScannerCartList items={[]} isConfirming={false} onAddQuantity={vi.fn()} onRemoveQuantity={vi.fn()} />
        <UnknownCodesBanner
          issues={[{
            code: '7501400800069',
            status: 'DUPLICATE',
            matches: [{ name: 'Bicarbonato uno' }, { name: 'Bicarbonato dos' }],
          }]}
          onClear={onClear}
        />
      </>
    );
    expect(screen.getByText('Escanea un producto para comenzar')).toBeInTheDocument();
    expect(screen.getByText('1 código con incidencia')).toBeInTheDocument();
    expect(screen.queryByText('Bicarbonato uno, Bicarbonato dos')).toBeNull();
    const details = screen.getByRole('button', { name: 'Ver detalles' });
    expect(details).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(details);
    expect(screen.getByRole('button', { name: 'Ocultar detalles' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText(/Bicarbonato uno, Bicarbonato dos/)).toBeInTheDocument();
    expect(screen.getByText(/Corrige la asignación/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Descartar avisos' }));
    expect(onClear).toHaveBeenCalledOnce();
  });

  it('distinguishes unavailable products from technical catalog lookup errors', () => {
    render(
      <UnknownCodesBanner
        issues={[
          { code: 'AAA', status: 'INACTIVE', productName: 'Producto apagado' },
          { code: 'BBB', status: 'NO_SELLABLE_BATCH' },
          { code: 'CCC', status: 'ERROR' },
        ]}
      />
    );
    expect(screen.getByText('3 códigos requieren revisión')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Ver detalles' }));
    expect(screen.getByText('Producto desactivado')).toBeInTheDocument();
    expect(screen.getByText('Producto sin lote disponible')).toBeInTheDocument();
    expect(screen.getByText('No se pudo consultar el catálogo')).toBeInTheDocument();
    expect(screen.getByText(/Puedes intentar escanearlo nuevamente/)).toBeInTheDocument();
  });

  it('shows feedback type from a semantic value rather than words in its message', () => {
    const view = render(
      <CameraViewport
        videoRef={{ current: null }}
        cameraError={null}
        scanFeedback="No se encontraron obstáculos"
        scanFeedbackType="success"
        isScanning
        isConfirming={false}
        onRetryCamera={vi.fn()}
        onDecodeRegionChange={vi.fn()}
      />
    );
    expect(view.container.querySelector('.scan-toast-success')).toBeInTheDocument();
    view.rerender(
      <CameraViewport
        videoRef={{ current: null }}
        cameraError={null}
        scanFeedback="Código duplicado"
        scanFeedbackType="warning"
        isScanning
        isConfirming={false}
        onRetryCamera={vi.fn()}
        onDecodeRegionChange={vi.fn()}
      />
    );
    expect(view.container.querySelector('.scan-toast-warning')).toBeInTheDocument();
  });
});
