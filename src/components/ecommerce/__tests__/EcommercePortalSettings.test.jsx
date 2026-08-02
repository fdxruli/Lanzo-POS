// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../../../store/useAppStore';
import EcommercePortalSettings from '../EcommercePortalSettings';
import {
  getEcommercePortal,
  listPublishedProducts,
  saveEcommercePortal,
  savePublishedProduct,
  setProductPublished
} from '../../../services/ecommerce/ecommerceAdminService';

vi.mock('../../../services/ecommerce/ecommerceAdminService', () => ({
  getEcommercePortal: vi.fn(),
  listPublishedProducts: vi.fn(),
  saveEcommercePortal: vi.fn(),
  savePublishedProduct: vi.fn(),
  setProductPublished: vi.fn(),
  syncPublishedCatalog: vi.fn(),
  saveOperatingSchedule: vi.fn(),
  setOrderPause: vi.fn()
}));

vi.mock('../../../services/products/productRepository', () => ({
  productRepository: {
    listProductsPage: vi.fn(),
    listCategories: vi.fn()
  }
}));

vi.mock('../EcommerceProductPublishModal', () => ({
  default: () => null
}));

vi.mock('../EcommercePortalCustomizationPanel', () => ({
  default: ({ onChange }) => (
    <fieldset>
      <legend>Identidad visual</legend>
      <span>Plantilla</span><span>Color principal</span><span>Color secundario</span>
      <span>Esquinas</span><span>Tipografía</span><span>Logo</span><span>Portada</span>
      <button type="button" onClick={() => onChange({
        templateCode: 'showcase', theme: {}, valid: true,
        logo: { value: null, intent: 'clear' },
        cover: { value: null, intent: 'preserve' }
      })}>Clear test logo</button>
      <button type="button" onClick={() => onChange({
        templateCode: 'showcase', theme: {}, valid: true,
        logo: { value: 'https://cdn.example/logo-new.png', intent: 'set' },
        cover: { value: 'https://cdn.example/cover-new.png', intent: 'set' }
      })}>Set test images</button>
      <button type="button" onClick={() => onChange({
        templateCode: 'showcase', theme: {}, valid: true,
        logo: { value: 'blob:preview', intent: 'set' },
        cover: { value: null, intent: 'clear' }
      })}>Set invalid test image</button>
      <button type="button" onClick={() => onChange({
        templateCode: 'compact', theme: { primaryColor: '#112233', fontStyle: 'editorial' }, valid: true,
        logo: { value: 'blob:logo-preview', intent: 'preserve' },
        cover: { value: 'blob:cover-preview', intent: 'preserve' }
      })}>Set local branding preview</button>
    </fieldset>
  )
}));

vi.mock('../EcommerceSiteBuilderFoundation', () => ({
  default: ({ portal, licenseKey, isPro }) => (
    <section data-testid="site-builder">
      <span>Editor visual del borrador</span>
      <output data-testid="builder-portal">{JSON.stringify(portal)}</output>
      <output data-testid="builder-license">{licenseKey}</output>
      <output data-testid="builder-plan">{String(isPro)}</output>
    </section>
  )
}));

const successfulPortalResponse = {
  success: true,
  portal: null,
  plan: { code: 'free_trial', name: 'Plan Free' },
  features: { customSlug: false, maxPublishedProducts: 10 }
};

const setStoreState = ({
  role,
  settings = false,
  ecommerce = false,
  initializing = false,
  licenseDetails = { license_key: 'license-fixture' }
}) => {
  useAppStore.setState({
    companyProfile: { name: 'Negocio de prueba' },
    currentDeviceRole: role,
    currentStaffUser: role === 'staff'
      ? { id: 'staff-fixture', permissions: { settings, ecommerce } }
      : null,
    licenseDetails,
    _isInitializing: initializing
  });
};

const expectNoAdminRpcCalls = () => {
  expect(getEcommercePortal).not.toHaveBeenCalled();
  expect(listPublishedProducts).not.toHaveBeenCalled();
  expect(saveEcommercePortal).not.toHaveBeenCalled();
  expect(savePublishedProduct).not.toHaveBeenCalled();
  expect(setProductPublished).not.toHaveBeenCalled();
};

describe('EcommercePortalSettings internal access guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getEcommercePortal.mockResolvedValue(successfulPortalResponse);
    listPublishedProducts.mockResolvedValue({ success: true, products: [] });
    setStoreState({ role: null, initializing: false, licenseDetails: null });
  });

  afterEach(() => {
    cleanup();
    setStoreState({ role: null, initializing: false, licenseDetails: null });
  });

  it('allows an admin device and loads the portal panel', async () => {
    act(() => setStoreState({ role: 'admin', settings: true }));

    render(<EcommercePortalSettings />);

    await waitFor(() => expect(getEcommercePortal).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('Datos visibles para tus clientes')).not.toBeNull();
    expect(screen.queryByText('No tienes permiso para administrar el portal online.')).toBeNull();
  });

  it('allows staff with settings and ecommerce permissions', async () => {
    act(() => setStoreState({ role: 'staff', settings: true, ecommerce: true }));

    render(<EcommercePortalSettings />);

    await waitFor(() => expect(getEcommercePortal).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('Datos visibles para tus clientes')).not.toBeNull();
    expect(screen.queryByText('Solo el propietario o dispositivo administrador puede configurar el portal online.')).toBeNull();
    expect(screen.queryByText('No tienes permiso para administrar el portal online.')).toBeNull();
  });

  it('blocks staff without ecommerce and does not call administrative RPCs', () => {
    act(() => setStoreState({ role: 'staff', settings: true, ecommerce: false }));

    render(<EcommercePortalSettings />);

    expect(screen.getByText('No tienes permiso para administrar el portal online.')).not.toBeNull();
    expectNoAdminRpcCalls();
  });

  it('blocks staff without settings and does not call administrative RPCs', () => {
    act(() => setStoreState({ role: 'staff', settings: false, ecommerce: true }));

    render(<EcommercePortalSettings />);

    expect(screen.getByText('No tienes permiso para administrar el portal online.')).not.toBeNull();
    expectNoAdminRpcCalls();
  });

  it('waits for staff state restoration and loads without a manual reload', async () => {
    act(() => setStoreState({
      role: null,
      initializing: true,
      licenseDetails: null
    }));

    render(<EcommercePortalSettings />);

    expect(screen.getByText('Cargando portal online...')).not.toBeNull();
    expect(screen.queryByText('No tienes permiso para administrar el portal online.')).toBeNull();
    expectNoAdminRpcCalls();

    act(() => setStoreState({
      role: 'staff',
      settings: true,
      ecommerce: true,
      initializing: false
    }));

    await waitFor(() => expect(getEcommercePortal).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('Datos visibles para tus clientes')).not.toBeNull();
    expect(screen.queryByText('No tienes permiso para administrar el portal online.')).toBeNull();
  });

  it('reacts to visual permission revocation without issuing new RPCs', async () => {
    act(() => setStoreState({ role: 'staff', settings: true, ecommerce: true }));

    render(<EcommercePortalSettings />);

    await waitFor(() => expect(getEcommercePortal).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('Datos visibles para tus clientes')).not.toBeNull();

    act(() => setStoreState({ role: 'staff', settings: true, ecommerce: false }));

    expect(await screen.findByText('No tienes permiso para administrar el portal online.')).not.toBeNull();
    expect(screen.queryByText('Datos visibles para tus clientes')).toBeNull();
    expect(getEcommercePortal).toHaveBeenCalledTimes(1);
    expect(listPublishedProducts).not.toHaveBeenCalled();
    expect(saveEcommercePortal).not.toHaveBeenCalled();
    expect(savePublishedProduct).not.toHaveBeenCalled();
    expect(setProductPublished).not.toHaveBeenCalled();
  });
});

describe('EcommercePortalSettings image intent payloads', () => {
  const proFeatures = {
    customSlug: true,
    cloudCatalogSource: true,
    maxPublishedProducts: -1
  };
  const existingPortal = {
    id: 'portal-fixture',
    name: 'Negocio de prueba',
    slug: 'negocio-prueba',
    status: 'draft',
    whatsappPhone: '529610000000',
    contactEmail: 'contacto@example.com',
    address: 'Calle pública 1, Centro, Comitán de Domínguez, Chiapas, C.P. 30000',
    addressStreet: 'Calle pública 1',
    addressNeighborhood: 'Centro',
    addressMunicipality: 'Comitán de Domínguez',
    addressState: 'Chiapas',
    addressPostalCode: '30000',
    pickupEnabled: true,
    deliveryEnabled: false,
    minOrderTotal: 0,
    logoUrl: 'https://cdn.example/logo-existing.png',
    coverImageUrl: 'https://cdn.example/cover-existing.png',
    templateCode: 'showcase',
    theme: {}
  };

  beforeEach(() => {
    vi.clearAllMocks();
    act(() => setStoreState({ role: 'admin', settings: true }));
    listPublishedProducts.mockResolvedValue({ success: true, products: [] });
  });

  afterEach(() => cleanup());

  const renderExistingProPortal = () => {
    getEcommercePortal.mockResolvedValue({
      success: true,
      portal: existingPortal,
      plan: { code: 'pro_monthly', name: 'Lanzo Nube' },
      features: proFeatures
    });
    saveEcommercePortal.mockResolvedValue({
      success: true,
      portal: existingPortal,
      plan: { code: 'pro_monthly', name: 'Lanzo Nube' },
      features: proFeatures
    });
    return render(<EcommercePortalSettings />);
  };

  const renderNewProPortal = () => {
    getEcommercePortal.mockResolvedValue({
      success: true,
      portal: null,
      plan: { code: 'pro_monthly', name: 'Lanzo Nube' },
      features: proFeatures
    });
    saveEcommercePortal.mockResolvedValue({
      success: true,
      portal: existingPortal,
      plan: { code: 'pro_monthly', name: 'Lanzo Nube' },
      features: proFeatures
    });
    return render(<EcommercePortalSettings />);
  };

  const renderExistingFreePortal = () => {
    const freeFeatures = {
      customSlug: false,
      cloudCatalogSource: false,
      maxPublishedProducts: 10
    };
    getEcommercePortal.mockResolvedValue({
      success: true,
      portal: existingPortal,
      plan: { code: 'free_trial', name: 'Plan Free' },
      features: freeFeatures
    });
    saveEcommercePortal.mockResolvedValue({
      success: true,
      portal: existingPortal,
      plan: { code: 'free_trial', name: 'Plan Free' },
      features: freeFeatures
    });
    return render(<EcommercePortalSettings />);
  };

  const saveNewProPortal = () => {
    fireEvent.click(screen.getByRole('button', { name: 'Crear tienda' }));
  };

  it('mounts the unified Pro builder with the current portal and license', async () => {
    renderExistingProPortal();
    await waitFor(() => expect(getEcommercePortal).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('tab', { name: 'Información' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByTestId('site-builder')).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'Diseño' }));
    expect(screen.getByTestId('site-builder')).toHaveTextContent('Editor visual del borrador');
    expect(screen.getByTestId('builder-portal')).toHaveTextContent('portal-fixture');
    expect(screen.getByTestId('builder-license')).toHaveTextContent('license-fixture');
    expect(screen.getByTestId('builder-plan')).toHaveTextContent('true');
    expect(screen.queryByRole('button', { name: 'Guardar identidad visual' })).toBeNull();
    expect(screen.queryByText('Identidad visual')).toBeNull();
  });

  it('does not use saveEcommercePortal while navigating through Pro design', async () => {
    renderExistingProPortal();
    await waitFor(() => expect(getEcommercePortal).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('tab', { name: 'Diseño' }));
    expect(screen.getByTestId('site-builder')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Información' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Diseño' }));
    expect(saveEcommercePortal).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Guardar identidad visual' })).toBeNull();
  });

  it('preserves pending Pro Information changes across a design tab round trip', async () => {
    renderExistingProPortal();
    await waitFor(() => expect(getEcommercePortal).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByDisplayValue('contacto@example.com'), { target: { value: 'pendiente@example.com' } });
    fireEvent.click(screen.getByRole('tab', { name: 'Diseño' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Información' }));
    expect(screen.getByDisplayValue('pendiente@example.com')).toBeInTheDocument();
    expect(saveEcommercePortal).not.toHaveBeenCalled();
  });

  it('saves Pro Information without transporting document-v2 branding fields', async () => {
    renderExistingProPortal();
    await waitFor(() => expect(getEcommercePortal).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByDisplayValue('contacto@example.com'), { target: { value: 'ventas@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar información' }));
    await waitFor(() => expect(saveEcommercePortal).toHaveBeenCalledTimes(1));
    expect(saveEcommercePortal.mock.calls[0][0]).toMatchObject({ contactEmail: 'ventas@example.com' });
    ['templateCode', 'theme', 'logoUrl', 'coverImageUrl'].forEach((field) => expect(saveEcommercePortal.mock.calls[0][0]).not.toHaveProperty(field));
  });

  it('does not ask Settings to persist the Pro builder draft', async () => {
    renderExistingProPortal();
    await waitFor(() => expect(getEcommercePortal).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('tab', { name: 'Diseño' }));
    expect(screen.getByTestId('site-builder')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Guardar borrador' })).toBeNull();
    expect(saveEcommercePortal).not.toHaveBeenCalled();
  });

  it('opens on business information and keeps the catalog one tap away', async () => {
    renderExistingProPortal();
    await waitFor(() => expect(getEcommercePortal).toHaveBeenCalledTimes(1));

    expect(screen.getByRole('tab', { name: 'Información' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByDisplayValue('Negocio de prueba')).toHaveAttribute('readonly');
    expect(screen.getByDisplayValue('529610000000')).not.toBeNull();
    expect(screen.getByDisplayValue('contacto@example.com')).not.toBeNull();
    expect(screen.getByDisplayValue('Calle pública 1')).not.toBeNull();
    expect(screen.getByDisplayValue('Centro')).not.toBeNull();
    expect(screen.getByDisplayValue('Comitán de Domínguez')).not.toBeNull();
    expect(screen.getByDisplayValue('Chiapas')).not.toBeNull();
    expect(screen.getByDisplayValue('30000')).not.toBeNull();
    expect(screen.queryByText('Tu tienda sencilla para compartir por WhatsApp')).toBeNull();
    expect(screen.queryByText(/Lanzo Nube incluye catalogo ilimitado/i)).toBeNull();
    expect(screen.queryByRole('tab', { name: 'Compartir' })).toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: 'Catálogo' }));

    expect(screen.getByPlaceholderText('Buscar productos')).not.toBeNull();
    expect(screen.queryByText('Datos visibles para tus clientes')).toBeNull();
  });

  it('blocks publication until WhatsApp and the pickup address are complete', async () => {
    getEcommercePortal.mockResolvedValue({
      success: true,
      portal: {
        ...existingPortal,
        whatsappPhone: null,
        address: null,
        addressStreet: null,
        addressNeighborhood: null,
        addressMunicipality: null,
        addressState: null,
        addressPostalCode: null
      },
      plan: { code: 'pro_monthly', name: 'Lanzo Nube' },
      features: proFeatures
    });

    render(<EcommercePortalSettings />);
    await waitFor(() => expect(getEcommercePortal).toHaveBeenCalledTimes(1));

    expect(screen.getByText('Completa los datos para publicar')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Publicar portal' })).toBeDisabled();
  });

  it('saves the public contact email from the information workspace', async () => {
    renderExistingProPortal();
    await waitFor(() => expect(getEcommercePortal).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByDisplayValue('contacto@example.com'), {
      target: { value: 'VENTAS@EXAMPLE.COM' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar información' }));

    await waitFor(() => expect(saveEcommercePortal).toHaveBeenCalledTimes(1));
    expect(saveEcommercePortal.mock.calls[0][0]).toMatchObject({
      name: 'Negocio de prueba',
      whatsappPhone: '529610000000',
      contactEmail: 'ventas@example.com',
      addressStreet: 'Calle pública 1',
      addressNeighborhood: 'Centro',
      addressMunicipality: 'Comitán de Domínguez',
      addressState: 'Chiapas',
      addressPostalCode: '30000'
    });
  });

  it('accepts S/N for street and neighborhood when the rest of the address is complete', async () => {
    renderExistingProPortal();
    await waitFor(() => expect(getEcommercePortal).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByDisplayValue('Calle pública 1'), {
      target: { value: 'S/N' }
    });
    fireEvent.change(screen.getByDisplayValue('Centro'), {
      target: { value: 's/n' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Publicar portal' }));

    await waitFor(() => expect(saveEcommercePortal).toHaveBeenCalledTimes(1));
    expect(saveEcommercePortal.mock.calls[0][0]).toMatchObject({
      status: 'published',
      addressStreet: 'S/N',
      addressNeighborhood: 's/n',
      addressMunicipality: 'Comitán de Domínguez',
      addressState: 'Chiapas',
      addressPostalCode: '30000'
    });
  });

  it('omits untouched image fields when creating a portal', async () => {
    renderNewProPortal();
    await waitFor(() => expect(getEcommercePortal).toHaveBeenCalledTimes(1));

    saveNewProPortal();

    await waitFor(() => expect(saveEcommercePortal).toHaveBeenCalledTimes(1));
    const payload = saveEcommercePortal.mock.calls[0][0];
    expect(payload).not.toHaveProperty('logoUrl');
    expect(payload).not.toHaveProperty('coverImageUrl');
  });

  it('keeps the Free presentation editor alongside the read-only builder preview', async () => {
    renderExistingFreePortal();
    await waitFor(() => expect(getEcommercePortal).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('tab', { name: 'Diseño' }));

    expect(screen.getByText('Presentación de tu tienda')).toBeInTheDocument();
    expect(screen.getByText('Identidad visual')).toBeInTheDocument();
    expect(screen.getByTestId('builder-plan')).toHaveTextContent('false');
    expect(screen.getByRole('button', { name: 'Guardar diseño' })).toBeInTheDocument();
  });

  it('saves an HTTPS replacement logo for an existing Free portal without a cover', async () => {
    renderExistingFreePortal();
    await waitFor(() => expect(getEcommercePortal).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('tab', { name: 'Diseño' }));
    fireEvent.click(screen.getByRole('button', { name: 'Set test images' }));
    fireEvent.click(screen.getByRole('button', { name: 'Guardar diseño' }));

    await waitFor(() => expect(saveEcommercePortal).toHaveBeenCalledTimes(1));
    const payload = saveEcommercePortal.mock.calls[0][0];
    expect(payload).toMatchObject({ logoUrl: 'https://cdn.example/logo-new.png' });
    expect(payload).not.toHaveProperty('coverImageUrl');
  });

  it('clears the logo for an existing Free portal without a cover', async () => {
    renderExistingFreePortal();
    await waitFor(() => expect(getEcommercePortal).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('tab', { name: 'Diseño' }));
    fireEvent.click(screen.getByRole('button', { name: 'Clear test logo' }));
    fireEvent.click(screen.getByRole('button', { name: 'Guardar diseño' }));

    await waitFor(() => expect(saveEcommercePortal).toHaveBeenCalledTimes(1));
    const payload = saveEcommercePortal.mock.calls[0][0];
    expect(payload).toMatchObject({ logoUrl: null });
    expect(payload).not.toHaveProperty('coverImageUrl');
  });

  it('preserves Free portal branding when no logo change is requested', async () => {
    renderExistingFreePortal();
    await waitFor(() => expect(getEcommercePortal).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('tab', { name: 'Diseño' }));
    fireEvent.click(screen.getByRole('button', { name: 'Guardar diseño' }));

    await waitFor(() => expect(saveEcommercePortal).toHaveBeenCalledTimes(1));
    const payload = saveEcommercePortal.mock.calls[0][0];
    expect(payload).not.toHaveProperty('logoUrl');
    expect(payload).not.toHaveProperty('coverImageUrl');
  });

  it('blocks a blob URL from the Free presentation editor before calling the RPC', async () => {
    renderExistingFreePortal();
    await waitFor(() => expect(getEcommercePortal).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('tab', { name: 'Diseño' }));
    fireEvent.click(screen.getByRole('button', { name: 'Set invalid test image' }));
    fireEvent.click(screen.getByRole('button', { name: 'Guardar diseño' }));

    expect(saveEcommercePortal).not.toHaveBeenCalled();
  });

  it('uses the profile logo only when creating a new portal', async () => {
    act(() => useAppStore.setState({ companyProfile: {
      name: 'Negocio de prueba', logo: 'https://cdn.example/profile-logo.png'
    } }));
    getEcommercePortal.mockResolvedValue({ success: true, portal: null, features: proFeatures });
    saveEcommercePortal.mockResolvedValue({ success: true, portal: existingPortal, features: proFeatures });

    render(<EcommercePortalSettings />);
    await waitFor(() => expect(getEcommercePortal).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'Crear tienda' }));

    await waitFor(() => expect(saveEcommercePortal).toHaveBeenCalledTimes(1));
    expect(saveEcommercePortal.mock.calls[0][0]).toMatchObject({
      logoUrl: 'https://cdn.example/profile-logo.png'
    });
  });
});
