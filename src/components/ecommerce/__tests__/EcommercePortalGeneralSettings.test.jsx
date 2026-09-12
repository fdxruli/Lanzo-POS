// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../../../store/useAppStore';
import EcommercePortalGeneralSettings, {
  resolveEcommerceGeneralSettingsCapabilities
} from '../EcommercePortalGeneralSettings';

const baseForm = Object.freeze({
  slug: 'mi-tienda-personalizada',
  headline: 'Entrega rápida',
  description: 'Descripción persistente',
  minOrderTotal: '150',
  pickupEnabled: true,
  deliveryEnabled: false
});

const handlers = new Map();
const onFieldChange = (field) => {
  if (!handlers.has(field)) handlers.set(field, vi.fn());
  return handlers.get(field);
};

const setPlan = (planCode, features = {}) => {
  useAppStore.setState({
    licenseDetails: {
      license_key: 'license-fixture',
      plan_code: planCode,
      features
    }
  });
};

const renderSettings = () => render(
  <EcommercePortalGeneralSettings form={baseForm} onFieldChange={onFieldChange} />
);

const expectGeneralControlsVisible = () => {
  expect(screen.getByLabelText('Slug de la tienda')).toBeInTheDocument();
  expect(screen.getByLabelText('Frase corta')).toBeInTheDocument();
  expect(screen.getByLabelText('Descripción')).toBeInTheDocument();
  expect(screen.getByLabelText('Pedido mínimo')).toBeInTheDocument();
  expect(screen.getByLabelText('Recoger')).toBeInTheDocument();
  expect(screen.getByLabelText('Domicilio')).toBeInTheDocument();
};

describe('EcommercePortalGeneralSettings plan parity', () => {
  afterEach(() => {
    cleanup();
    handlers.clear();
    act(() => useAppStore.setState({ licenseDetails: null }));
  });

  it('normalizes FREE and PRO capabilities from current license contracts', () => {
    expect(resolveEcommerceGeneralSettingsCapabilities({
      plan_code: 'free_trial',
      features: {
        ecommerce_custom_slug: false,
        ecommerce_delivery_pickup_settings: 'basic'
      }
    })).toEqual({
      customSlugAllowed: false,
      deliveryPickupSettings: 'basic'
    });

    expect(resolveEcommerceGeneralSettingsCapabilities({
      plan_code: 'pro_monthly',
      features: {
        ecommerce_custom_slug: true,
        ecommerce_delivery_pickup_settings: 'advanced'
      }
    })).toEqual({
      customSlugAllowed: true,
      deliveryPickupSettings: 'advanced'
    });
  });

  it('keeps every general control visible in FREE while locking the slug', () => {
    act(() => setPlan('free_trial', {
      ecommerce_custom_slug: false,
      ecommerce_delivery_pickup_settings: 'basic'
    }));

    renderSettings();
    expectGeneralControlsVisible();
    expect(screen.getByLabelText('Slug de la tienda')).toBeDisabled();
    expect(screen.getByLabelText('Slug de la tienda')).toHaveValue('mi-tienda-personalizada');
    expect(screen.getByText('Configuración básica')).toBeInTheDocument();
  });

  it('keeps every general control visible in PRO and unlocks the slug', () => {
    act(() => setPlan('pro_monthly', {
      ecommerce_custom_slug: true,
      ecommerce_delivery_pickup_settings: 'advanced'
    }));

    renderSettings();
    expectGeneralControlsVisible();
    expect(screen.getByLabelText('Slug de la tienda')).not.toBeDisabled();
    expect(screen.getByLabelText('Slug de la tienda')).toHaveValue('mi-tienda-personalizada');
    expect(screen.getByText('Configuración avanzada')).toBeInTheDocument();
  });

  it('preserves values and toggles only slug editability across FREE → PRO → FREE → PRO', () => {
    act(() => setPlan('free_trial', {
      ecommerce_custom_slug: false,
      ecommerce_delivery_pickup_settings: 'basic'
    }));

    const view = renderSettings();
    const assertState = (editable) => {
      expectGeneralControlsVisible();
      expect(screen.getByLabelText('Slug de la tienda')).toHaveValue('mi-tienda-personalizada');
      expect(screen.getByLabelText('Frase corta')).toHaveValue('Entrega rápida');
      expect(screen.getByLabelText('Descripción')).toHaveValue('Descripción persistente');
      expect(screen.getByLabelText('Pedido mínimo')).toHaveValue(150);
      expect(screen.getByLabelText('Recoger')).toBeChecked();
      expect(screen.getByLabelText('Domicilio')).not.toBeChecked();
      if (editable) expect(screen.getByLabelText('Slug de la tienda')).not.toBeDisabled();
      else expect(screen.getByLabelText('Slug de la tienda')).toBeDisabled();
    };

    assertState(false);

    act(() => setPlan('pro_monthly', {
      ecommerce_custom_slug: true,
      ecommerce_delivery_pickup_settings: 'advanced'
    }));
    view.rerender(<EcommercePortalGeneralSettings form={baseForm} onFieldChange={onFieldChange} />);
    assertState(true);

    act(() => setPlan('free_trial', {
      ecommerce_custom_slug: false,
      ecommerce_delivery_pickup_settings: 'basic'
    }));
    view.rerender(<EcommercePortalGeneralSettings form={baseForm} onFieldChange={onFieldChange} />);
    assertState(false);

    act(() => setPlan('pro_monthly', {
      ecommerce_custom_slug: true,
      ecommerce_delivery_pickup_settings: 'advanced'
    }));
    view.rerender(<EcommercePortalGeneralSettings form={baseForm} onFieldChange={onFieldChange} />);
    assertState(true);
  });

  it('keeps an existing custom slug visible but read-only after downgrade', () => {
    act(() => setPlan('free_trial', {
      ecommerce_custom_slug: false,
      ecommerce_delivery_pickup_settings: 'basic'
    }));

    renderSettings();
    const slug = screen.getByLabelText('Slug de la tienda');
    expect(slug).toHaveValue('mi-tienda-personalizada');
    expect(slug).toBeDisabled();
  });
});
