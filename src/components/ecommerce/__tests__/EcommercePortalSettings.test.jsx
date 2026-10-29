// @vitest-environment jsdom
import { act, cleanup, fireEvent, render as rtlRender, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../../../store/useAppStore';
import { ecommerceCatalogSyncService } from '../../../services/ecommerce/ecommerceCatalogSyncService';
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

const render = (ui, options) => {
  const view = rtlRender(<MemoryRouter>{ui}</MemoryRouter>, options);
  return {
    ...view,
    rerender: (nextUi) => view.rerender(<MemoryRouter>{nextUi}</MemoryRouter>)
  };
};

const successfulPortalResponse = {
  success: true,
  portal: null,
  plan: { code: 'free_trial', name: 'Plan Free' },
  features: { customSlug: false, deliveryPickupSettings: 'basic', maxPublishedProducts: 10 }
};

const DEFAULT_LICENSE_FEATURES = {
  ecommerce_portal_enabled: true,
  ecommerce_order_inbox: true
};

const setStoreState = ({
  role,
  settings = false,
  ecommerce = false,
  initializing = false,
  licenseStatus = 'active',
  licenseDetails = {
    license_key: 'license-fixture',
    features: DEFAULT_LICENSE_FEATURES
  }
}) => {
  useAppStore.setState({
    companyProfile: { name: 'Negocio de prueba' },
    currentDeviceRole: role,
    currentStaffUser: role === 'staff'
      ? { id: 'staff-fixture', permissions: { settings, ecommerce } }
      : null,
    licenseStatus,
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

const expectNoAdminRpcCallsExceptInitialPortalRead = () => {
  expect(getEcommercePortal).toHaveBeenCalledTimes(1);
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

  it('keeps the Local tabs accessible before portal creation without enabling remote operations', async () => {
    act(() => setStoreState({ role: 'admin', settings: true }));

    render(<EcommercePortalSettings />);

    expect(await screen.findByRole('tablist', { name: 'Secciones del portal' })).toBeInTheDocument();
    ['Información', 'Catálogo', 'Operación', 'Diseño', 'Lanzo Nube'].forEach((name) => {
      expect(screen.getByRole('tab', { name })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('tab', { name: 'Catálogo' }));
    expect(screen.getByRole('tabpanel', { name: 'Catálogo' })).toBeInTheDocument();
    expect(screen.getByText(/Aún no se encontró una tienda configurada/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Publicar producto' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Operación' }));
    expect(screen.getByRole('tabpanel', { name: 'Operación' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Guardar horarios/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Diseño' }));
    expect(screen.getByRole('tabpanel', { name: 'Diseño' })).toBeInTheDocument();
    expect(screen.getByText('Diseño de tu tienda')).toBeInTheDocument();
    expect(screen.queryByText('Personaliza tu tienda y crea una experiencia única')).not.toBeInTheDocument();
    expect(screen.queryByTestId('site-builder')).not.toBeInTheDocument();
    expect(listPublishedProducts).not.toHaveBeenCalled();
    expect(savePublishedProduct).not.toHaveBeenCalled();
    expect(setProductPublished).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Ir a Información' }));
    expect(screen.getByRole('tabpanel', { name: 'Información' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Crear tienda' })).toBeInTheDocument();
    expect(saveEcommercePortal).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Ver beneficios' }));
    expect(screen.getByRole('tabpanel', { name: 'Lanzo Nube' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Lleva tu tienda al siguiente nivel' })).toHaveFocus();
    expect(screen.getByRole('heading', { name: 'Una tienda con identidad propia' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Más espacio para tus productos' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Mantén conectado tu catálogo' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Haz que tus clientes reconozcan tu tienda' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Más contexto para operar' })).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Conocer Lanzo Nube' })).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'Conocer Lanzo Nube' })).toHaveAttribute('href', '/acerca-de');
    expect(screen.getByText('Consultar esta información no modifica tu licencia ni tu plan.')).toBeInTheDocument();
    expect(getEcommercePortal).toHaveBeenCalledTimes(1);
    expectNoAdminRpcCallsExceptInitialPortalRead();
  });

  it('supports arrow-key tab navigation and keeps every tab-panel association present', async () => {
    act(() => setStoreState({ role: 'admin', settings: true }));
    render(<EcommercePortalSettings />);

    const informationTab = await screen.findByRole('tab', { name: 'Información' });
    const tabs = screen.getAllByRole('tab');
    expect(informationTab).toHaveAttribute('tabIndex', '0');
    tabs.forEach((tab) => {
      const panel = document.getElementById(tab.getAttribute('aria-controls'));
      expect(panel).not.toBeNull();
      expect(panel).toHaveAttribute('role', 'tabpanel');
      expect(panel).toHaveAttribute('aria-labelledby', tab.id);
    });

    fireEvent.keyDown(informationTab, { key: 'ArrowRight' });
    const catalogTab = screen.getByRole('tab', { name: 'Catálogo' });
    expect(catalogTab).toHaveAttribute('aria-selected', 'true');
    expect(catalogTab).toHaveFocus();
    expect(catalogTab).toHaveAttribute('tabIndex', '0');
  });

  it('does not show Lanzo Nube when the plan response cannot be confirmed', async () => {
    getEcommercePortal.mockResolvedValue({
      success: true,
      portal: null,
      features: successfulPortalResponse.features
    });
    act(() => setStoreState({ role: 'admin', settings: true }));
    render(<EcommercePortalSettings />);

    expect(await screen.findByRole('tab', { name: 'Información' })).toBeInTheDocument();
    expect(screen.getAllByRole('tab')).toHaveLength(4);
    expect(screen.queryByRole('tab', { name: 'Lanzo Nube' })).not.toBeInTheDocument();
  });

  it('does not show Lanzo Nube during a license grace period', async () => {
    act(() => setStoreState({ role: 'admin', settings: true, licenseStatus: 'grace_period' }));
    render(<EcommercePortalSettings />);

    expect(await screen.findByRole('tab', { name: 'Información' })).toBeInTheDocument();
    expect(screen.getAllByRole('tab')).toHaveLength(4);
    expect(screen.queryByRole('tab', { name: 'Lanzo Nube' })).not.toBeInTheDocument();
  });

  it('does not show Lanzo Nube for an inconclusive license state', async () => {
    act(() => setStoreState({ role: 'admin', settings: true, licenseStatus: 'validation_inconclusive' }));
    render(<EcommercePortalSettings />);

    expect(await screen.findByRole('tab', { name: 'Información' })).toBeInTheDocument();
    expect(screen.getAllByRole('tab')).toHaveLength(4);
    expect(screen.queryByRole('tab', { name: 'Lanzo Nube' })).not.toBeInTheDocument();
  });

  it('does not show Lanzo Nube when the local license is invalid', async () => {
    act(() => setStoreState({
      role: 'admin',
      settings: true,
      licenseDetails: {
        license_key: 'license-fixture',
        valid: false,
        features: DEFAULT_LICENSE_FEATURES
      }
    }));
    render(<EcommercePortalSettings />);

    expect(await screen.findByRole('tab', { name: 'Información' })).toBeInTheDocument();
    expect(screen.getAllByRole('tab')).toHaveLength(4);
    expect(screen.queryByRole('tab', { name: 'Lanzo Nube' })).not.toBeInTheDocument();
  });

  it('hides the Free discovery tab offline and revalidates the plan after reconnecting', async () => {
    act(() => setStoreState({ role: 'admin', settings: true }));
    render(<EcommercePortalSettings />);

    expect(await screen.findByRole('tab', { name: 'Lanzo Nube' })).toBeInTheDocument();

    act(() => window.dispatchEvent(new Event('offline')));
    expect(screen.queryByRole('tab', { name: 'Lanzo Nube' })).not.toBeInTheDocument();

    act(() => window.dispatchEvent(new Event('online')));
    expect(await screen.findByRole('tab', { name: 'Lanzo Nube' })).toBeInTheDocument();
    expect(getEcommercePortal).toHaveBeenCalledTimes(2);
  });

  it('does not show Lanzo Nube after portal authorization fails offline', async () => {
    getEcommercePortal.mockResolvedValue({
      success: false,
      message: 'Necesitas conexion a internet para configurar el portal online.'
    });
    act(() => setStoreState({ role: 'admin', settings: true }));
    render(<EcommercePortalSettings />);

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Lanzo Nube' })).not.toBeInTheDocument();
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
    deliveryPickupSettings: 'advanced',
    cloudCatalogSource: true,
    maxPublishedProducts: -1,
    brandingCustomization: 'advanced',
    layoutCustomization: 'advanced',
    stockVisibility: true
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
      deliveryPickupSettings: 'basic',
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
    expect(screen.getAllByRole('tab')).toHaveLength(4);
    expect(screen.queryByRole('tab', { name: 'Lanzo Nube' })).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Información' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByTestId('site-builder')).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'Diseño' }));
    expect(screen.getByTestId('site-builder')).toHaveTextContent('Editor visual del borrador');
    expect(screen.getByTestId('builder-portal')).toHaveTextContent('portal-fixture');
    expect(screen.getByTestId('builder-license')).toHaveTextContent('license-fixture');
    expect(screen.getByTestId('builder-plan')).toHaveTextContent('true');
    expect(screen.queryByText('Personaliza tu tienda y crea una experiencia única')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Conocer Lanzo Nube' })).toBeNull();
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

  it('shows a compact design hint for Free without mounting the Pro builder', async () => {
    const syncStatus = vi.spyOn(ecommerceCatalogSyncService, 'getStatus');
    renderExistingFreePortal();
    await waitFor(() => expect(getEcommercePortal).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('tab', { name: 'Diseño' }));

    expect(screen.getByText('Diseño de tu tienda')).toBeInTheDocument();
    expect(screen.getByText('Tu tienda utiliza las opciones de presentación disponibles en tu plan.')).toBeInTheDocument();
    expect(screen.getByText('El constructor visual avanzado está disponible con Lanzo Nube.')).toBeInTheDocument();
    expect(screen.queryByText('Personaliza tu tienda y crea una experiencia única')).not.toBeInTheDocument();
    expect(screen.queryByTestId('site-builder')).toBeNull();
    expect(syncStatus).not.toHaveBeenCalled();
    expect(screen.queryByText('Personalización Portal PRO')).not.toBeInTheDocument();
    expect(screen.queryByText('Identidad visual')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Guardar diseño' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ver beneficios' })).toBeInTheDocument();
    syncStatus.mockRestore();
  });

  it('does not treat catalog sync entitlement as permission to load the site builder', async () => {
    const partialFreeFeatures = {
      customSlug: false,
      deliveryPickupSettings: 'basic',
      maxPublishedProducts: 2,
      cloudCatalogSource: true,
      brandingCustomization: 'basic',
      layoutCustomization: 'template_only'
    };
    getEcommercePortal.mockResolvedValue({
      success: true,
      portal: existingPortal,
      plan: { code: 'free_trial', name: 'Plan Free' },
      features: partialFreeFeatures
    });
    listPublishedProducts.mockResolvedValue({ success: true, products: [] });

    render(<EcommercePortalSettings />);
    await waitFor(() => expect(getEcommercePortal).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('tab', { name: 'Diseño' }));

    expect(screen.getByText('El constructor visual avanzado está disponible con Lanzo Nube.')).toBeInTheDocument();
    expect(screen.queryByTestId('site-builder')).toBeNull();
  });

  it('uses the license product limit and keeps existing product actions available at the limit', async () => {
    const freeFeatures = {
      customSlug: false,
      deliveryPickupSettings: 'basic',
      maxPublishedProducts: 2,
      cloudCatalogSource: false,
      brandingCustomization: 'basic',
      layoutCustomization: 'template_only'
    };
    getEcommercePortal.mockResolvedValue({
      success: true,
      portal: existingPortal,
      plan: { code: 'free_trial', name: 'Plan Free' },
      features: freeFeatures
    });
    listPublishedProducts.mockResolvedValue({
      success: true,
      products: [
        { id: 'published-1', localProductRef: 'local-1', publicName: 'Producto uno', price: 10, isPublished: true, isAvailable: true },
        { id: 'published-2', localProductRef: 'local-2', publicName: 'Producto dos', price: 20, isPublished: true, isAvailable: true }
      ]
    });

    render(<EcommercePortalSettings requestedSection="catalog" />);
    await waitFor(() => expect(getEcommercePortal).toHaveBeenCalledTimes(1));

    expect(screen.getByRole('tabpanel', { name: 'Catálogo' })).toHaveAttribute('id', 'ecom-portal-panel-catalog');
    expect(screen.getByText('2 / 2 productos publicados')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Publicar producto' })).toBeDisabled();
    expect(screen.getByText('Llegaste al límite de productos publicados de tu plan.')).toBeInTheDocument();
    expect(screen.getByText('Puedes continuar editando o despublicando productos existentes.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Editar Producto uno' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Despublicar Producto uno' })).toBeEnabled();
    expect(screen.queryByText('Haz crecer tu catálogo con Lanzo Nube')).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Ver beneficios' })).toHaveLength(2);
  });

  it('keeps Free design informational and does not save branding without an entitlement', async () => {
    renderExistingFreePortal();
    await waitFor(() => expect(getEcommercePortal).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('tab', { name: 'Diseño' }));

    expect(screen.getByText('Diseño de tu tienda')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ver beneficios' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Guardar diseño' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Set test images' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Ver beneficios' }));
    expect(screen.getByRole('tabpanel', { name: 'Lanzo Nube' })).toBeInTheDocument();
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

  it('uses RPC PRO features when licenseDetails is stale FREE', async () => {
    act(() => setStoreState({
      role: 'admin',
      settings: true,
      licenseDetails: {
        license_key: 'license-fixture',
        plan_code: 'free_trial',
        features: { ...DEFAULT_LICENSE_FEATURES, ecommerce_custom_slug: false }
      }
    }));
    renderExistingProPortal();
    await waitFor(() => expect(getEcommercePortal).toHaveBeenCalledTimes(1));
    expect(screen.getByLabelText('Slug de la tienda')).not.toBeDisabled();
    expect(screen.getByTestId('ecommerce-general-settings')).toHaveAttribute('data-plan-code', 'pro_monthly');
  });

  it('uses RPC FREE features when licenseDetails is stale PRO', async () => {
    act(() => setStoreState({
      role: 'admin',
      settings: true,
      licenseDetails: {
        license_key: 'license-fixture',
        plan_code: 'pro_monthly',
        features: { ...DEFAULT_LICENSE_FEATURES, ecommerce_custom_slug: true }
      }
    }));
    renderExistingFreePortal();
    await waitFor(() => expect(getEcommercePortal).toHaveBeenCalledTimes(1));
    expect(screen.getByLabelText('Slug de la tienda')).toBeDisabled();
    expect(screen.getByTestId('ecommerce-general-settings')).toHaveAttribute('data-plan-code', 'free_trial');
  });

  it('renders each general control exactly once for PRO and none inside Design', async () => {
    renderExistingProPortal();
    await waitFor(() => expect(getEcommercePortal).toHaveBeenCalledTimes(1));
    ['Slug de la tienda', 'Frase corta', 'Descripción', 'Pedido mínimo', 'Recoger', 'Domicilio']
      .forEach((label) => expect(screen.getAllByLabelText(label)).toHaveLength(1));

    fireEvent.click(screen.getByRole('tab', { name: 'Diseño' }));
    expect(screen.queryByText('Frase corta / headline')).toBeNull();
    expect(screen.queryByText('Pedido mínimo')).toBeNull();
    expect(screen.queryByText('Métodos de entrega')).toBeNull();
    expect(screen.queryByLabelText('Slug de la tienda')).toBeNull();
  });

  it('renders each general control exactly once for FREE and removes legacy controls from Design', async () => {
    renderExistingFreePortal();
    await waitFor(() => expect(getEcommercePortal).toHaveBeenCalledTimes(1));
    ['Slug de la tienda', 'Frase corta', 'Descripción', 'Pedido mínimo', 'Recoger', 'Domicilio']
      .forEach((label) => expect(screen.getAllByLabelText(label)).toHaveLength(1));

    fireEvent.click(screen.getByRole('tab', { name: 'Diseño' }));
    expect(screen.getByText('Diseño de tu tienda')).toBeInTheDocument();
    expect(screen.getByText('El constructor visual avanzado está disponible con Lanzo Nube.')).toBeInTheDocument();
    expect(screen.queryByText('Identidad visual de tu tienda')).not.toBeInTheDocument();
    expect(screen.queryByText('Enlace / slug *')).toBeNull();
    expect(screen.queryByText('Frase corta / headline')).toBeNull();
    expect(screen.queryByText('Descripcion')).toBeNull();
    expect(screen.queryByText('Pedido minimo')).toBeNull();
    expect(screen.queryByText('Metodos de entrega')).toBeNull();
    expect(screen.queryByLabelText('Slug de la tienda')).toBeNull();
  });

  it('saves the complete shared commercial settings payload from PRO Information', async () => {
    renderExistingProPortal();
    await waitFor(() => expect(getEcommercePortal).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByLabelText('Frase corta'), {
      target: { value: 'Headline actualizado' }
    });
    fireEvent.change(screen.getByLabelText('Descripción'), {
      target: { value: 'Descripción actualizada desde Información' }
    });
    fireEvent.change(screen.getByLabelText('Pedido mínimo'), {
      target: { value: '275.50' }
    });
    fireEvent.click(screen.getByLabelText('Recoger'));
    fireEvent.click(screen.getByLabelText('Domicilio'));
    fireEvent.change(screen.getByLabelText('Slug de la tienda'), {
      target: { value: 'negocio-pro-actualizado' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar información' }));

    await waitFor(() => expect(saveEcommercePortal).toHaveBeenCalledTimes(1));
    expect(saveEcommercePortal.mock.calls[0][0]).toMatchObject({
      headline: 'Headline actualizado',
      description: 'Descripción actualizada desde Información',
      minOrderTotal: 275.5,
      pickupEnabled: false,
      deliveryEnabled: true,
      slug: 'negocio-pro-actualizado'
    });
  });

});
