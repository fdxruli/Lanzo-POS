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
    <div>
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
    </div>
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
    expect(await screen.findByText('Aun no existe un portal')).not.toBeNull();
    expect(screen.queryByText('No tienes permiso para administrar el portal online.')).toBeNull();
  });

  it('allows staff with settings and ecommerce permissions', async () => {
    act(() => setStoreState({ role: 'staff', settings: true, ecommerce: true }));

    render(<EcommercePortalSettings />);

    await waitFor(() => expect(getEcommercePortal).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('Aun no existe un portal')).not.toBeNull();
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
    expect(await screen.findByText('Aun no existe un portal')).not.toBeNull();
    expect(screen.queryByText('No tienes permiso para administrar el portal online.')).toBeNull();
  });

  it('reacts to visual permission revocation without issuing new RPCs', async () => {
    act(() => setStoreState({ role: 'staff', settings: true, ecommerce: true }));

    render(<EcommercePortalSettings />);

    await waitFor(() => expect(getEcommercePortal).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('Aun no existe un portal')).not.toBeNull();

    act(() => setStoreState({ role: 'staff', settings: true, ecommerce: false }));

    expect(await screen.findByText('No tienes permiso para administrar el portal online.')).not.toBeNull();
    expect(screen.queryByText('Aun no existe un portal')).toBeNull();
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

  const renderExistingPortal = () => {
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

  it('omits untouched image fields for an existing portal', async () => {
    renderExistingPortal();
    await waitFor(() => expect(getEcommercePortal).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('button', { name: 'Guardar portal' }));

    await waitFor(() => expect(saveEcommercePortal).toHaveBeenCalledTimes(1));
    const payload = saveEcommercePortal.mock.calls[0][0];
    expect(payload).not.toHaveProperty('logoUrl');
    expect(payload).not.toHaveProperty('coverImageUrl');
  });

  it('sends explicit null only when the logo is unlinked', async () => {
    renderExistingPortal();
    await waitFor(() => expect(getEcommercePortal).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'Clear test logo' }));
    fireEvent.click(screen.getByRole('button', { name: 'Guardar portal' }));

    await waitFor(() => expect(saveEcommercePortal).toHaveBeenCalledTimes(1));
    expect(saveEcommercePortal.mock.calls[0][0]).toMatchObject({ logoUrl: null });
    expect(saveEcommercePortal.mock.calls[0][0]).not.toHaveProperty('coverImageUrl');
  });

  it('sends HTTPS replacement images', async () => {
    renderExistingPortal();
    await waitFor(() => expect(getEcommercePortal).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'Set test images' }));
    fireEvent.click(screen.getByRole('button', { name: 'Guardar portal' }));

    await waitFor(() => expect(saveEcommercePortal).toHaveBeenCalledTimes(1));
    expect(saveEcommercePortal.mock.calls[0][0]).toMatchObject({
      logoUrl: 'https://cdn.example/logo-new.png',
      coverImageUrl: 'https://cdn.example/cover-new.png'
    });
  });

  it('never transports a blob URL', async () => {
    renderExistingPortal();
    await waitFor(() => expect(getEcommercePortal).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'Set invalid test image' }));
    fireEvent.click(screen.getByRole('button', { name: 'Guardar portal' }));
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
    fireEvent.change(screen.getByPlaceholderText('mi-negocio'), {
      target: { value: 'negocio-prueba' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar portal' }));

    await waitFor(() => expect(saveEcommercePortal).toHaveBeenCalledTimes(1));
    expect(saveEcommercePortal.mock.calls[0][0]).toMatchObject({
      logoUrl: 'https://cdn.example/profile-logo.png'
    });
  });
});
