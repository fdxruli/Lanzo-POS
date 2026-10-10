// @vitest-environment jsdom
import { act, cleanup, fireEvent, render as rtlRender, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
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
const render = (ui, options) => {
  const view = rtlRender(<MemoryRouter>{ui}</MemoryRouter>, options);
  return {
    ...view,
    rerender: (nextUi) => view.rerender(<MemoryRouter>{nextUi}</MemoryRouter>)
  };
};
const onFieldChange = (field) => {
  if (!handlers.has(field)) handlers.set(field, vi.fn());
  return handlers.get(field);
};
const onOpenNubeBenefits = vi.fn();

const FREE_PLAN = Object.freeze({ code: 'free_trial', name: 'Plan Free' });
const PRO_PLAN = Object.freeze({ code: 'pro_monthly', name: 'Lanzo Nube' });
const FREE_FEATURES = Object.freeze({
  customSlug: false,
  deliveryPickupSettings: 'basic'
});
const PRO_FEATURES = Object.freeze({
  customSlug: true,
  deliveryPickupSettings: 'advanced'
});

const renderSettings = ({
  plan = FREE_PLAN,
  features = FREE_FEATURES,
  showNubeBenefits = plan?.code === 'free_trial'
} = {}) => render(
  <EcommercePortalGeneralSettings
    form={baseForm}
    onFieldChange={onFieldChange}
    plan={plan}
    features={features}
    showNubeBenefits={showNubeBenefits}
    onOpenNubeBenefits={onOpenNubeBenefits}
  />
);

const expectGeneralControlsVisible = () => {
  expect(screen.getByLabelText('Slug de la tienda')).toBeInTheDocument();
  expect(screen.getByLabelText('Frase corta')).toBeInTheDocument();
  expect(screen.getByLabelText('Descripción')).toBeInTheDocument();
  expect(screen.getByLabelText('Pedido mínimo')).toBeInTheDocument();
  expect(screen.getByLabelText('Recoger')).toBeInTheDocument();
  expect(screen.getByLabelText('Domicilio')).toBeInTheDocument();
};

describe('EcommercePortalGeneralSettings authoritative plan parity', () => {
  afterEach(() => {
    cleanup();
    handlers.clear();
    onOpenNubeBenefits.mockClear();
    act(() => useAppStore.setState({ licenseDetails: null }));
  });

  it('derives capabilities only from administrative portal features', () => {
    expect(resolveEcommerceGeneralSettingsCapabilities({
      customSlug: false,
      deliveryPickupSettings: 'basic'
    })).toEqual({
      customSlugAllowed: false,
      deliveryPickupSettings: 'basic'
    });

    expect(resolveEcommerceGeneralSettingsCapabilities({
      customSlug: true,
      deliveryPickupSettings: 'advanced'
    })).toEqual({
      customSlugAllowed: true,
      deliveryPickupSettings: 'advanced'
    });
  });

  it('does not let a Pro plan code override explicit customSlug=false', () => {
    renderSettings({
      plan: PRO_PLAN,
      features: { customSlug: false, deliveryPickupSettings: 'advanced' }
    });
    expect(screen.getByLabelText('Slug de la tienda')).toBeDisabled();
    expect(screen.getByText('Configuración avanzada')).toBeInTheDocument();
  });

  it('keeps every general control visible in FREE while locking the slug', () => {
    renderSettings();
    expectGeneralControlsVisible();
    expect(screen.getByLabelText('Slug de la tienda')).toBeDisabled();
    expect(screen.getByLabelText('Slug de la tienda')).toHaveValue('mi-tienda-personalizada');
    expect(screen.getByText('Configuración básica')).toBeInTheDocument();
  });

  it('keeps every general control visible in PRO and unlocks the slug', () => {
    renderSettings({ plan: PRO_PLAN, features: PRO_FEATURES });
    expectGeneralControlsVisible();
    expect(screen.getByLabelText('Slug de la tienda')).not.toBeDisabled();
    expect(screen.getByLabelText('Slug de la tienda')).toHaveValue('mi-tienda-personalizada');
    expect(screen.getByText('Configuración avanzada')).toBeInTheDocument();
  });

  it('ignores stale FREE licenseDetails when RPC plan/features are PRO', () => {
    act(() => useAppStore.setState({
      licenseDetails: {
        license_key: 'license-fixture',
        plan_code: 'free_trial',
        features: { ecommerce_custom_slug: false }
      }
    }));
    renderSettings({ plan: PRO_PLAN, features: PRO_FEATURES });
    expect(screen.getByLabelText('Slug de la tienda')).not.toBeDisabled();
  });

  it('ignores stale PRO licenseDetails when RPC plan/features are FREE', () => {
    act(() => useAppStore.setState({
      licenseDetails: {
        license_key: 'license-fixture',
        plan_code: 'pro_monthly',
        features: { ecommerce_custom_slug: true }
      }
    }));
    renderSettings({ plan: FREE_PLAN, features: FREE_FEATURES });
    expect(screen.getByLabelText('Slug de la tienda')).toBeDisabled();
  });

  it('preserves values and toggles only authoritative capabilities across FREE → PRO → FREE → PRO', () => {
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
    view.rerender(
      <EcommercePortalGeneralSettings form={baseForm} onFieldChange={onFieldChange} plan={PRO_PLAN} features={PRO_FEATURES} />
    );
    assertState(true);
    view.rerender(
      <EcommercePortalGeneralSettings form={baseForm} onFieldChange={onFieldChange} plan={FREE_PLAN} features={FREE_FEATURES} />
    );
    assertState(false);
    view.rerender(
      <EcommercePortalGeneralSettings form={baseForm} onFieldChange={onFieldChange} plan={PRO_PLAN} features={PRO_FEATURES} />
    );
    assertState(true);
  });

  it('keeps an existing custom slug visible but read-only after downgrade', () => {
    renderSettings();
    const slug = screen.getByLabelText('Slug de la tienda');
    expect(slug).toHaveValue('mi-tienda-personalizada');
    expect(slug).toBeDisabled();
    expect(screen.getByText('Personalizar este enlace está disponible con Lanzo Nube.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Ver beneficios' }));
    expect(onOpenNubeBenefits).toHaveBeenCalledTimes(1);
  });

  it('does not show slug discovery to an authorized PRO plan', () => {
    renderSettings({ plan: PRO_PLAN, features: PRO_FEATURES });
    expect(screen.queryByText('Personalizar este enlace está disponible con Lanzo Nube.')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Slug de la tienda')).toBeEnabled();
  });

  it('keeps a denied slug compact when discovery is not authorized', () => {
    renderSettings({ showNubeBenefits: false });
    expect(screen.getByLabelText('Slug de la tienda')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Ver beneficios' })).not.toBeInTheDocument();
  });
});
