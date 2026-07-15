// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
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
