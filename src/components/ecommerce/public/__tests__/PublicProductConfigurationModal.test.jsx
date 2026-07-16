// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PublicProductConfigurationModal from '../PublicProductConfigurationModal';

const serviceMocks = vi.hoisted(() => ({ getPublicProductConfiguration: vi.fn() }));
vi.mock('../../../../services/ecommerce/ecommercePublicService', () => ({
  getPublicProductConfiguration: serviceMocks.getPublicProductConfiguration
}));

const publicDetail = {
  success: true,
  catalogRevision: 7,
  product: {
    id: 'product-1', name: 'Playera Urban', description: 'Algodón', imageUrl: '',
    currency: 'MXN', basePrice: 100, configurationType: 'variant_parent',
    configurationVersion: 3, requiresConfiguration: true, hasVariants: true,
    hasOptionGroups: true, isAvailable: true
  },
  variants: [
    { id: 'v-black-m', publicName: 'Negro / M', optionValues: { color: 'Negro', talla: 'M' }, priceMode: 'base', priceValue: 0, imageUrl: '', stock: { mode: 'hidden', status: 'available', quantity: null }, isAvailable: true },
    { id: 'v-white-l', publicName: 'Blanco / L', optionValues: { color: 'Blanco', talla: 'L' }, priceMode: 'delta', priceValue: 20, imageUrl: '', stock: { mode: 'hidden', status: 'available', quantity: null }, isAvailable: true }
  ],
  groups: [
    {
      id: 'g-print', publicName: 'Estampado', selectionType: 'single', required: true,
      minSelect: 1, maxSelect: 1, options: [
        { id: 'o-none', publicName: 'Sin estampado', priceDelta: 0, isAvailable: true },
        { id: 'o-logo', publicName: 'Logo', priceDelta: 15, isAvailable: true }
      ]
    },
    {
      id: 'g-extras', publicName: 'Extras', selectionType: 'multiple', required: false,
      minSelect: 0, maxSelect: 2, options: [
        { id: 'o-wrap', publicName: 'Envoltura', priceDelta: 5, isAvailable: true },
        { id: 'o-sticker', publicName: 'Sticker', priceDelta: 3, isAvailable: true },
        { id: 'o-bag', publicName: 'Bolsa', priceDelta: 2, isAvailable: true }
      ]
    }
  ]
};

const props = {
  isOpen: true, slug: 'mi-negocio', product: {
    id: 'product-1', name: 'Playera Urban', price: 100, currency: 'MXN',
    configuration: { type: 'variant_parent', version: 3, hasVariants: true, hasOptionGroups: true, requiresConfiguration: true }
  },
  catalogRevision: 7, offline: false, maxItemQuantity: 9,
  onClose: vi.fn(), onAdd: vi.fn(() => true)
};

describe('PublicProductConfigurationModal', () => {
  beforeEach(() => {
    serviceMocks.getPublicProductConfiguration.mockReset().mockResolvedValue(publicDetail);
    props.onClose.mockReset(); props.onAdd.mockReset().mockReturnValue(true);
  });
  afterEach(cleanup);

  it('loads once, requires a concrete variant and required option, then adds a configured line', async () => {
    const user = userEvent.setup();
    render(<PublicProductConfigurationModal {...props} />);
    expect(await screen.findByRole('heading', { name: 'Playera Urban' })).toBeInTheDocument();
    await screen.findByRole('button', { name: 'Negro' });

    await user.click(screen.getByRole('button', { name: 'Añadir al carrito' }));
    expect(await screen.findByText('Selecciona una variante.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Negro' }));
    await user.click(screen.getByRole('button', { name: 'M' }));
    await user.click(screen.getByRole('radio', { name: /Logo/ }));
    expect(screen.getAllByText('$115.00', { selector: 'strong' }).length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: 'Añadir al carrito' }));

    expect(props.onAdd).toHaveBeenCalledTimes(1);
    expect(props.onAdd.mock.calls[0][0]).toMatchObject({
      success: true, productId: 'product-1', variantId: 'v-black-m', estimatedUnitPrice: 115,
      selections: [{ groupId: 'g-print', optionIds: ['o-logo'] }]
    });
    expect(props.onClose).toHaveBeenCalled();
  });

  it('permite seleccionar varios extras hasta el máximo y suma todos los precios', async () => {
    const user = userEvent.setup();
    render(<PublicProductConfigurationModal {...props} />);
    await screen.findByRole('heading', { name: 'Playera Urban' });

    await user.click(screen.getByRole('button', { name: 'Negro' }));
    await user.click(screen.getByRole('button', { name: 'M' }));
    await user.click(screen.getByRole('radio', { name: /Logo/ }));

    const wrap = screen.getByRole('checkbox', { name: /Envoltura/ });
    const sticker = screen.getByRole('checkbox', { name: /Sticker/ });
    const bag = screen.getByRole('checkbox', { name: /Bolsa/ });
    await user.click(wrap);
    await user.click(sticker);

    expect(wrap).toBeChecked();
    expect(sticker).toBeChecked();
    expect(bag).toBeDisabled();
    expect(screen.getAllByText('$123.00', { selector: 'strong' }).length).toBeGreaterThan(0);

    await user.click(screen.getByRole('button', { name: 'Añadir al carrito' }));
    const configuredLine = props.onAdd.mock.calls[0][0];
    expect(configuredLine.estimatedUnitPrice).toBe(123);
    expect(configuredLine.selections).toEqual(expect.arrayContaining([
      { groupId: 'g-print', optionIds: ['o-logo'] },
      { groupId: 'g-extras', optionIds: ['o-sticker', 'o-wrap'] }
    ]));
  });

  it('restores a prior configuration for editing and replaces the original line', async () => {
    const user = userEvent.setup();
    const initialLine = {
      lineKey: 'old-line', productId: 'product-1', quantity: 2, variantId: 'v-white-l',
      selections: [{ groupId: 'g-print', optionIds: ['o-none'] }],
      configurationSnapshot: { variant: { optionValues: { color: 'Blanco', talla: 'L' } } }
    };
    render(<PublicProductConfigurationModal {...props} initialLine={initialLine} />);
    expect(await screen.findByRole('button', { name: 'Blanco' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'L' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('radio', { name: /Sin estampado/ })).toBeChecked();
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    expect(props.onAdd.mock.calls[0][1]).toEqual({ replaceLineKey: 'old-line' });
  });

  it('keeps unexpected load failures public-safe and offers retry', async () => {
    serviceMocks.getPublicProductConfiguration.mockRejectedValueOnce(new Error('network secret'));
    const user = userEvent.setup();
    render(<PublicProductConfigurationModal {...props} offline />);
    expect(await screen.findByText('No se pudo cargar la configuración')).toBeInTheDocument();
    expect(screen.queryByText('network secret')).not.toBeInTheDocument();
    serviceMocks.getPublicProductConfiguration.mockResolvedValueOnce(publicDetail);
    await user.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByText('Estampado')).toBeInTheDocument();
  });
});
