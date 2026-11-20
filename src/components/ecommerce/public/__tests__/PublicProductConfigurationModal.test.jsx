// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
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
    configurationVersion: 3, configurationRevision: 'b'.repeat(64),
    requiresConfiguration: true, hasVariants: true, hasOptionGroups: true,
    isAvailable: true, availability: { message: 'Disponible' }
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
    id: 'product-1', name: 'Playera Urban', description: 'Algodón', price: 100, currency: 'MXN',
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
    const initialSummary = screen.getByRole('region', { name: 'Resumen de selección' });

    await user.click(screen.getByRole('button', { name: 'Añadir al carrito' }));
    expect(within(initialSummary).getByText('Selecciona una variante.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Negro' }));
    await user.click(screen.getByRole('button', { name: 'M' }));
    await user.click(screen.getByRole('radio', { name: /Logo/ }));
    const summary = screen.getByRole('region', { name: 'Resumen de selección' });
    expect(within(summary).getByText('Color')).toBeInTheDocument();
    expect(within(summary).getByText('Negro')).toBeInTheDocument();
    expect(within(summary).getByText('Talla')).toBeInTheDocument();
    expect(within(summary).getByText('M')).toBeInTheDocument();
    expect(within(summary).getByText('Estampado')).toBeInTheDocument();
    expect(within(summary).getByText('Logo')).toBeInTheDocument();
    expect(within(summary).getByText('Total')).toBeInTheDocument();
    expect(within(summary).getByText('$115.00')).toBeInTheDocument();
    expect(screen.getAllByText('$115.00', { selector: 'strong' }).length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: 'Añadir al carrito' }));

    expect(props.onAdd).toHaveBeenCalledTimes(1);
    expect(props.onAdd.mock.calls[0][0]).toMatchObject({
      success: true, productId: 'product-1', variantId: 'v-black-m', estimatedUnitPrice: 115,
      selections: [{ groupId: 'g-print', optionIds: ['o-logo'] }]
    });
    expect(props.onClose).toHaveBeenCalled();
  });

  it('keeps required selections visible in the summary and blocks an incomplete add', async () => {
    const user = userEvent.setup();
    render(<PublicProductConfigurationModal {...props} />);
    await screen.findByRole('button', { name: 'Negro' });
    const summary = screen.getByRole('region', { name: 'Resumen de selección' });

    expect(within(summary).getByText('Selecciona una variante.')).toBeInTheDocument();
    expect(within(summary).getByText('Estampado: Selecciona una opción.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Añadir al carrito' }));

    expect(props.onAdd).not.toHaveBeenCalled();
    expect(within(summary).getByText('Selecciona una variante.')).toBeInTheDocument();
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
    const summary = screen.getByRole('region', { name: 'Resumen de selección' });
    expect(within(summary).getByText('Envoltura, Sticker')).toBeInTheDocument();
    expect(within(summary).getByText('$123.00')).toBeInTheDocument();
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
    const summary = await screen.findByRole('region', { name: 'Resumen de selección' });
    expect(await screen.findByRole('button', { name: 'Blanco' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'L' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('radio', { name: /Sin estampado/ })).toBeChecked();
    expect(within(summary).getByText('Blanco')).toBeInTheDocument();
    expect(within(summary).getByText('L')).toBeInTheDocument();
    expect(within(summary).getByText('Sin estampado')).toBeInTheDocument();
    expect(within(summary).getByText('Cantidad')).toBeInTheDocument();
    expect(within(summary).getByText('2')).toBeInTheDocument();
    expect(within(summary).getByText('$240.00')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    expect(props.onAdd.mock.calls[0][1]).toEqual({ replaceLineKey: 'old-line' });
  });

  it('shows an unavailable prior variant without presenting it as a valid selection', async () => {
    const unavailableDetail = {
      ...publicDetail,
      variants: publicDetail.variants.map((variant) => ({ ...variant, isAvailable: false }))
    };
    serviceMocks.getPublicProductConfiguration.mockResolvedValueOnce(unavailableDetail);
    const initialLine = {
      lineKey: 'old-line', productId: 'product-1', quantity: 2, variantId: 'v-white-l',
      selections: [{ groupId: 'g-print', optionIds: ['o-none'] }],
      configurationSnapshot: { variant: { optionValues: { color: 'Blanco', talla: 'L' } } }
    };
    render(<PublicProductConfigurationModal {...props} initialLine={initialLine} />);

    const summary = await screen.findByRole('region', { name: 'Resumen de selección' });
    expect(within(summary).getByText('Blanco')).toBeInTheDocument();
    expect(within(summary).getByText('L')).toBeInTheDocument();
    expect(within(summary).getByText('La combinación seleccionada no está disponible.')).toBeInTheDocument();
    expect(within(summary).getByText('Precio pendiente')).toBeInTheDocument();
    expect(within(summary).queryByText('$200.00')).not.toBeInTheDocument();
    expect(screen.getByText('Precio pendiente', { selector: '.public-product-config__footer span' })).toBeInTheDocument();
    expect(screen.getByText('—', { selector: '.public-product-config__footer strong' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeEnabled();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Guardar cambios' }));
    expect(props.onAdd).not.toHaveBeenCalled();
  });

  it('keeps restaurant option groups and their price adjustments in the existing configurator', async () => {
    const restaurantDetail = {
      ...publicDetail,
      product: {
        ...publicDetail.product,
        id: 'pizza-1', name: 'Pizza de verduras', description: 'Masa horneada al momento.',
        configurationType: 'option_groups', configurationVersion: 1,
        configurationRevision: 'c'.repeat(64), requiresConfiguration: true,
        hasVariants: false, hasOptionGroups: true
      },
      variants: [],
      groups: [
        {
          id: 'g-size', publicName: 'Tamaño', selectionType: 'single', required: true,
          minSelect: 1, maxSelect: 1, options: [
            { id: 'o-medium', publicName: 'Mediana', priceDelta: 30, isAvailable: true }
          ]
        },
        {
          id: 'g-extra', publicName: 'Extras', selectionType: 'multiple', required: false,
          minSelect: 0, maxSelect: 1, options: [
            { id: 'o-cheese', publicName: 'Queso extra', priceDelta: 20, isAvailable: true }
          ]
        }
      ]
    };
    serviceMocks.getPublicProductConfiguration.mockResolvedValueOnce(restaurantDetail);
    const onAdd = vi.fn(() => true);
    const user = userEvent.setup();
    render(<PublicProductConfigurationModal
      {...props}
      product={{
        id: 'pizza-1', name: 'Pizza de verduras', price: 100, currency: 'MXN',
        configuration: { requiresConfiguration: true, hasOptionGroups: true, version: 1 }
      }}
      onAdd={onAdd}
    />);

    await user.click(await screen.findByRole('radio', { name: /Mediana/ }));
    const summary = screen.getByRole('region', { name: 'Resumen de selección' });
    expect(within(summary).getByText('Tamaño')).toBeInTheDocument();
    expect(within(summary).getByText('Mediana')).toBeInTheDocument();
    expect(within(summary).queryByText('Extras')).not.toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: /Queso extra/ }));
    expect(within(summary).getByText('Extras')).toBeInTheDocument();
    expect(within(summary).getByText('Queso extra')).toBeInTheDocument();
    expect(within(summary).getByText('$150.00')).toBeInTheDocument();
    expect(screen.getAllByText('$150.00', { selector: 'strong' }).length).toBeGreaterThan(0);

    await user.click(screen.getByRole('button', { name: 'Añadir al carrito' }));
    expect(onAdd.mock.calls[0][0]).toMatchObject({
      success: true,
      productId: 'pizza-1',
      selections: expect.arrayContaining([
        { groupId: 'g-size', optionIds: ['o-medium'] },
        { groupId: 'g-extra', optionIds: ['o-cheese'] }
      ]),
      estimatedUnitPrice: 150
    });
  });

  it('keeps unexpected load failures public-safe and offers retry', async () => {
    serviceMocks.getPublicProductConfiguration.mockRejectedValueOnce(new Error('network secret'));
    const user = userEvent.setup();
    render(<PublicProductConfigurationModal {...props} offline />);
    expect(await screen.findByText('No se pudo cargar la configuración')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Resumen de selección' })).not.toBeInTheDocument();
    expect(screen.getByText('Algodón')).toBeInTheDocument();
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cerrar configuración' })).toBeEnabled();
    expect(screen.getAllByText('—')).toHaveLength(1);
    expect(screen.queryByText('network secret')).not.toBeInTheDocument();
    serviceMocks.getPublicProductConfiguration.mockResolvedValueOnce(publicDetail);
    await user.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByText('Estampado')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Resumen de selección' })).toBeInTheDocument();
  });

  it('hides prices and picked values when the published configuration cannot be trusted', async () => {
    const staleDetail = {
      ...publicDetail,
      product: { ...publicDetail.product, configurationRevision: '' }
    };
    serviceMocks.getPublicProductConfiguration.mockResolvedValueOnce(staleDetail);
    render(<PublicProductConfigurationModal {...props} />);

    const summary = await screen.findByRole('region', { name: 'Resumen de selección' });
    expect(within(summary).getByRole('alert')).toHaveTextContent('La configuración cambió. Vuelve a cargar las opciones.');
    expect(within(summary).queryByText('Precio unitario')).not.toBeInTheDocument();
    expect(within(summary).queryByText('Cantidad')).not.toBeInTheDocument();
    expect(within(summary).queryByText('$100.00')).not.toBeInTheDocument();
    expect(screen.getByText('Precio no disponible')).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('updates quantity and total together before adding the configured line', async () => {
    const user = userEvent.setup();
    render(<PublicProductConfigurationModal {...props} />);
    await screen.findByRole('button', { name: 'Negro' });
    await user.click(screen.getByRole('button', { name: 'Negro' }));
    await user.click(screen.getByRole('button', { name: 'M' }));
    await user.click(screen.getByRole('radio', { name: /Logo/ }));
    await user.click(screen.getByRole('button', { name: 'Aumentar cantidad de Playera Urban' }));

    const summary = screen.getByRole('region', { name: 'Resumen de selección' });
    expect(within(summary).getByText('Cantidad')).toBeInTheDocument();
    expect(within(summary).getByText('2')).toBeInTheDocument();
    expect(within(summary).getByText('$230.00')).toBeInTheDocument();
    expect(screen.getByText('$230.00', { selector: '.public-product-config__footer strong' })).toBeInTheDocument();
  });

  it('clears prior selections when the configured product changes', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<PublicProductConfigurationModal {...props} />);
    await screen.findByRole('button', { name: 'Negro' });
    await user.click(screen.getByRole('button', { name: 'Negro' }));
    await user.click(screen.getByRole('button', { name: 'M' }));
    await user.click(screen.getByRole('radio', { name: /Logo/ }));

    const nextProductDetail = {
      ...publicDetail,
      product: {
        ...publicDetail.product,
        id: 'cup-1', name: 'Taza personalizada', configurationType: 'option_groups',
        hasVariants: false, hasOptionGroups: true, requiresConfiguration: true
      },
      variants: [],
      groups: [{
        id: 'g-engraving', publicName: 'Grabado', selectionType: 'single', required: true,
        minSelect: 1, maxSelect: 1,
        options: [{ id: 'o-name', publicName: 'Nombre', priceDelta: 10, isAvailable: true }]
      }]
    };
    serviceMocks.getPublicProductConfiguration.mockResolvedValueOnce(nextProductDetail);
    rerender(<PublicProductConfigurationModal
      {...props}
      product={{
        id: 'cup-1', name: 'Taza personalizada', price: 100, currency: 'MXN',
        configuration: { requiresConfiguration: true, hasOptionGroups: true, version: 1 }
      }}
    />);

    await screen.findByRole('radio', { name: /Nombre/ });
    const summary = screen.getByRole('region', { name: 'Resumen de selección' });
    expect(within(summary).queryByText('Negro')).not.toBeInTheDocument();
    expect(within(summary).queryByText('Logo')).not.toBeInTheDocument();
    expect(within(summary).getByText('Grabado: Selecciona una opción.')).toBeInTheDocument();
  });

  it('does not show empty selection summaries when a product has no variant or option groups', async () => {
    const simpleDetail = {
      ...publicDetail,
      product: {
        ...publicDetail.product,
        configurationType: 'simple', hasVariants: false, hasOptionGroups: false,
        requiresConfiguration: false
      },
      variants: [], groups: []
    };
    serviceMocks.getPublicProductConfiguration.mockResolvedValueOnce(simpleDetail);
    render(<PublicProductConfigurationModal
      {...props}
      product={{ ...props.product, configuration: {} }}
    />);

    await screen.findByRole('region', { name: 'Cantidad' });
    expect(screen.queryByRole('region', { name: 'Resumen de selección' })).not.toBeInTheDocument();
  });
});
