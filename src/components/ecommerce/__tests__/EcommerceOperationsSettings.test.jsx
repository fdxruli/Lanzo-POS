// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import EcommerceOperatingHoursSettings from '../EcommerceOperatingHoursSettings';
import EcommerceOrderPauseControl from '../EcommerceOrderPauseControl';
import { saveOperatingSchedule, setOrderPause } from '../../../services/ecommerce/ecommerceAdminService';

const toastMocks = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));

vi.mock('react-hot-toast', () => ({ default: toastMocks }));

vi.mock('../../../services/ecommerce/ecommerceAdminService', () => ({
  saveOperatingSchedule: vi.fn(),
  setOrderPause: vi.fn()
}));

const openAvailability = {
  acceptingOrders: true,
  code: 'OPEN',
  timezone: 'America/Mexico_City',
  nextCloseAt: '2026-07-15T03:00:00.000Z'
};

describe('ECOM.OPERATIONS.1 admin controls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    saveOperatingSchedule.mockResolvedValue({ success: true, hours: {}, availability: openAvailability });
    setOrderPause.mockResolvedValue({ success: true, availability: openAvailability });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('loads the saved timezone and weekly schedule', () => {
    render(<EcommerceOperatingHoursSettings data={{
      timezone: 'America/Tijuana',
      businessHoursEnabled: true,
      hours: {
        weekly: [{ weekday: 0, isOpen: true, opensAt: '10:00', closesAt: '16:00' }],
        exceptions: []
      },
      availability: openAvailability
    }} />);

    expect(screen.getByLabelText('Zona horaria del negocio')).toHaveValue('America/Tijuana');
    expect(screen.getByText('Aplicar horario a los pedidos').closest('label').querySelector('input')).toBeChecked();
    expect(screen.getByLabelText('Apertura Domingo')).toHaveValue('10:00');
    expect(screen.getByLabelText('Cierre Domingo')).toHaveValue('16:00');
  });

  it('renders Monday through Sunday while preserving backend weekday values', async () => {
    render(<EcommerceOperatingHoursSettings data={{
      timezone: 'America/Mexico_City',
      businessHoursEnabled: false,
      hours: { weekly: [], exceptions: [] },
      availability: openAvailability
    }} />);
    const labels = screen.getAllByText(/^(Lunes|Martes|Miércoles|Jueves|Viernes|Sábado|Domingo)$/);
    expect(labels.map((node) => node.textContent)).toEqual([
      'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'
    ]);
    fireEvent.click(screen.getByLabelText('Apertura Lunes').closest('.ecom-week-row').querySelector('input[type="checkbox"]'));
    fireEvent.click(screen.getByRole('button', { name: 'Guardar horarios' }));
    await waitFor(() => expect(saveOperatingSchedule).toHaveBeenCalled());
    expect(saveOperatingSchedule.mock.calls[0][0].weekly[0].weekday).toBe(1);
    expect(saveOperatingSchedule.mock.calls[0][0].weekly[6].weekday).toBe(0);
  });

  it('validates an enabled schedule and invalid intervals before calling the service', async () => {
    render(<EcommerceOperatingHoursSettings data={{
      timezone: 'America/Mexico_City',
      businessHoursEnabled: false,
      hours: { weekly: [], exceptions: [] },
      availability: openAvailability
    }} />);

    fireEvent.click(screen.getByText('Aplicar horario a los pedidos').closest('label').querySelector('input'));
    fireEvent.click(screen.getByRole('button', { name: 'Guardar horarios' }));
    expect(toastMocks.error).toHaveBeenCalledWith(expect.stringContaining('al menos un día abierto'));
    expect(saveOperatingSchedule).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('Lunes').closest('.ecom-week-row').querySelector('input[type="checkbox"]'));
    fireEvent.change(screen.getByLabelText('Apertura Lunes'), { target: { value: '18:00' } });
    fireEvent.change(screen.getByLabelText('Cierre Lunes'), { target: { value: '09:00' } });
    expect(screen.getByRole('alert')).toHaveTextContent('Lunes');
    fireEvent.click(screen.getByRole('button', { name: 'Guardar horarios' }));
    expect(saveOperatingSchedule).not.toHaveBeenCalled();
  });

  it('saves timezone, enabled weekly hours and an open exception', async () => {
    const onSaved = vi.fn();
    render(<EcommerceOperatingHoursSettings data={{
      timezone: 'America/Mexico_City',
      businessHoursEnabled: false,
      hours: { weekly: [], exceptions: [] },
      availability: openAvailability
    }} onSaved={onSaved} />);

    fireEvent.change(screen.getByLabelText('Zona horaria del negocio'), { target: { value: 'America/Cancun' } });
    fireEvent.click(screen.getByText('Aplicar horario a los pedidos').closest('label').querySelector('input'));
    fireEvent.click(screen.getByText('Lunes').closest('.ecom-week-row').querySelector('input[type="checkbox"]'));
    fireEvent.change(screen.getByLabelText('Apertura Lunes'), { target: { value: '08:30' } });
    fireEvent.change(screen.getByLabelText('Cierre Lunes'), { target: { value: '17:30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Agregar' }));
    fireEvent.change(screen.getByLabelText('Fecha de excepción'), { target: { value: '2026-08-01' } });
    fireEvent.click(screen.getByLabelText('Apertura de excepción').closest('.ecom-exception-row').querySelector('input[type="checkbox"]'));
    fireEvent.change(screen.getByLabelText('Apertura de excepción'), { target: { value: '10:00' } });
    fireEvent.change(screen.getByLabelText('Cierre de excepción'), { target: { value: '14:00' } });
    fireEvent.change(screen.getByLabelText('Razón de excepción'), { target: { value: 'Evento especial' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar horarios' }));

    await waitFor(() => expect(saveOperatingSchedule).toHaveBeenCalledWith(expect.objectContaining({
      timezone: 'America/Cancun',
      businessHoursEnabled: true,
      exceptions: [expect.objectContaining({
        date: '2026-08-01', isOpen: true, opensAt: '10:00', closesAt: '14:00', reason: 'Evento especial'
      })]
    })));
    expect(saveOperatingSchedule.mock.calls[0][0].weekly.find((day) => day.weekday === 1)).toEqual({
      weekday: 1, isOpen: true, opensAt: '08:30', closesAt: '17:30'
    });
    expect(onSaved).toHaveBeenCalled();
  });

  it('pauses indefinitely and resumes without changing portal status', async () => {
    const { rerender } = render(<EcommerceOrderPauseControl data={{
      timezone: 'America/Mexico_City', availability: openAvailability
    }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Pausar pedidos' }));
    await waitFor(() => expect(setOrderPause).toHaveBeenCalledWith(expect.objectContaining({
      paused: true, resumeAt: null
    })));

    rerender(<EcommerceOrderPauseControl data={{
      timezone: 'America/Mexico_City',
      availability: { ...openAvailability, acceptingOrders: false, code: 'ORDERS_PAUSED', manuallyPaused: true }
    }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Reanudar pedidos' }));
    await waitFor(() => expect(setOrderPause).toHaveBeenLastCalledWith({ paused: false }));
  });

  it('creates a deterministic 30 minute pause and surfaces safe service errors', async () => {
    const now = Date.parse('2026-07-15T12:00:00.000Z');
    const dateNowSpy = vi.spyOn(Date, 'now').mockReturnValue(now);
    render(<EcommerceOrderPauseControl data={{
      timezone: 'America/Mexico_City', availability: openAvailability
    }} />);
    fireEvent.change(screen.getByLabelText('Duración'), { target: { value: '30' } });
    fireEvent.change(screen.getByLabelText('Razón'), { target: { value: 'Mantenimiento' } });
    fireEvent.click(screen.getByRole('button', { name: 'Pausar pedidos' }));
    await waitFor(() => expect(setOrderPause).toHaveBeenCalledWith({
      paused: true,
      reason: 'Mantenimiento',
      resumeAt: '2026-07-15T12:30:00.000Z'
    }));
    dateNowSpy.mockRestore();

    setOrderPause.mockResolvedValueOnce({
      success: false,
      code: 'ECOMMERCE_PAUSE_UNTIL_INVALID',
      message: 'La reanudación debe programarse para una fecha futura.'
    });
    fireEvent.click(screen.getByRole('button', { name: 'Pausar pedidos' }));
    await waitFor(() => expect(toastMocks.error).toHaveBeenCalledWith(
      'La reanudación debe programarse para una fecha futura.'
    ));
  });
});
