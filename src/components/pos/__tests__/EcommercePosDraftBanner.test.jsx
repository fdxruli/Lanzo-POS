// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import EcommercePosDraftBanner from '../EcommercePosDraftBanner';

describe('EcommercePosDraftBanner', () => {
  it('shows safe ecommerce provenance and reconciliation warnings without PII', () => {
    const onOpenDetail = vi.fn();
    const order = {
      origin: 'ecommerce',
      ecommerceOrderCode: 'EC-00000012',
      fulfillmentMethod: 'delivery',
      expectedTotal: 125.5,
      currency: 'MXN',
      customerPhone: '9610000000',
      customerAddress: 'Privada 123',
      customerNotes: 'Tocar timbre'
    };

    render(
      <EcommercePosDraftBanner
        order={order}
        warnings={['Hay precios POS diferentes.', 'Hay lote pendiente.']}
        onOpenDetail={onOpenDetail}
      />
    );

    expect(screen.getByLabelText('Pedido online preparado')).toHaveTextContent('Pedido online EC-00000012');
    expect(screen.getByText('Entrega')).toBeInTheDocument();
    expect(screen.getByText('$125.50 MXN')).toBeInTheDocument();
    expect(screen.getByText('Preparado para revisión')).toBeInTheDocument();
    expect(screen.getByText('Hay precios POS diferentes.')).toBeInTheDocument();
    expect(screen.queryByText('9610000000')).not.toBeInTheDocument();
    expect(screen.queryByText('Privada 123')).not.toBeInTheDocument();
    expect(screen.queryByText('Tocar timbre')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Volver al detalle del pedido' }));
    expect(onOpenDetail).toHaveBeenCalledTimes(1);
  });

  it('renders nothing for a normal POS order', () => {
    const { container } = render(<EcommercePosDraftBanner order={{ origin: 'pos' }} />);
    expect(container).toBeEmptyDOMElement();
  });
});
