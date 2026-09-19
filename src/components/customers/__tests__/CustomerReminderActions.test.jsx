// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import CustomerReminderActions from '../CustomerReminderActions';

const customer = (overrides = {}) => ({
    id: 'customer-ruly',
    name: 'Ruly',
    debt: 125,
    ...overrides
});

const reminder = (overrides = {}) => ({
    id: 'reminder-technical-id',
    customer_id: 'customer-ruly',
    status: 'programado',
    scheduled_for: '2026-09-20T16:00:00.000Z',
    time_zone: 'America/Mexico_City',
    ...overrides
});

afterEach(cleanup);

describe('CustomerReminderActions', () => {
    it('lets an Admin schedule a positive-balance customer and then exposes the status', () => {
        const onSchedule = vi.fn();
        const onCancel = vi.fn();
        const onReschedule = vi.fn();
        const { rerender } = render(
            <CustomerReminderActions
                customer={customer()}
                cloudEnabled
                configEnabled
                canManage
                onSchedule={onSchedule}
            />
        );

        fireEvent.click(screen.getByRole('button', { name: 'Programar recordatorio' }));
        expect(onSchedule).toHaveBeenCalledWith(customer());

        rerender(
            <CustomerReminderActions
                customer={customer()}
                reminder={reminder()}
                cloudEnabled
                configEnabled
                canManage
                onCancel={onCancel}
                onReschedule={onReschedule}
            />
        );

        expect(screen.getByText('Recordatorio: Programado')).toBeVisible();
        const dateInput = screen.getByLabelText(/Nueva fecha del recordatorio para Ruly/i);
        expect(screen.getByRole('button', { name: 'Reprogramar' })).toBeEnabled();
        expect(screen.getByRole('button', { name: 'Cancelar' })).toBeEnabled();
        fireEvent.change(dateInput, { target: { value: '2026-09-21T10:00' } });
        fireEvent.click(screen.getByRole('button', { name: 'Reprogramar' }));
        fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
        expect(onReschedule).toHaveBeenCalledWith(customer(), reminder(), '2026-09-21T10:00');
        expect(onCancel).toHaveBeenCalledWith(customer(), reminder());
    });

    it('does not offer scheduling for a zero-balance customer', () => {
        render(
            <CustomerReminderActions
                customer={customer({ debt: 0 })}
                cloudEnabled
                configEnabled
                canManage
                onSchedule={vi.fn()}
            />
        );

        expect(screen.getByText('Este cliente no tiene saldo pendiente.')).toBeVisible();
        expect(screen.queryByRole('button', { name: 'Programar recordatorio' })).not.toBeInTheDocument();
    });

    it('blocks scheduling when the global reminder configuration is disabled', () => {
        const onSchedule = vi.fn();
        render(
            <CustomerReminderActions
                customer={customer()}
                cloudEnabled
                configEnabled={false}
                canManage
                onSchedule={onSchedule}
            />
        );

        const button = screen.getByRole('button', { name: 'Programar recordatorio' });
        expect(button).toBeDisabled();
        expect(screen.getByText('Activa primero los recordatorios cloud en Configuración.')).toBeVisible();
        fireEvent.click(button);
        expect(onSchedule).not.toHaveBeenCalled();
    });

    it('lets Staff consult the status but never shows mutation actions or technical IDs', () => {
        render(
            <CustomerReminderActions
                customer={customer()}
                reminder={reminder()}
                cloudEnabled
                configEnabled
                canManage={false}
            />
        );

        expect(screen.getByText('Recordatorio: Programado')).toBeVisible();
        expect(screen.getByText(/Staff puede consultar el estado/i)).toBeVisible();
        expect(screen.queryByRole('button', { name: 'Programar recordatorio' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Reprogramar' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Cancelar' })).not.toBeInTheDocument();
        expect(screen.queryByText('reminder-technical-id')).not.toBeInTheDocument();
        expect(screen.queryByText('customer-ruly')).not.toBeInTheDocument();
    });

    it('shows the duplicate-window confirmation and Spanish RPC errors', () => {
        const view = render(
            <CustomerReminderActions
                customer={customer()}
                reminder={reminder()}
                cloudEnabled
                configEnabled
                canManage
                feedback={{ type: 'success', message: 'Este cliente ya tiene un recordatorio programado.' }}
            />
        );

        expect(screen.getByText('Este cliente ya tiene un recordatorio programado.')).toBeVisible();

        view.rerender(
            <CustomerReminderActions
                customer={customer()}
                cloudEnabled
                configError="No se pudo cancelar el recordatorio. Intenta de nuevo."
            />
        );

        expect(screen.getByText('No se pudo cancelar el recordatorio. Intenta de nuevo.')).toBeVisible();
    });

    it('blocks cloud scheduling for an expired license without grace', () => {
        render(
            <CustomerReminderActions
                customer={customer()}
                cloudEnabled
                configEnabled
                canManage
                configError="Los recordatorios cloud requieren una licencia Pro/Nube vigente."
                onSchedule={vi.fn()}
            />
        );

        expect(screen.getByText('Los recordatorios cloud requieren una licencia Pro/Nube vigente.')).toBeVisible();
        expect(screen.queryByRole('button', { name: 'Programar recordatorio' })).not.toBeInTheDocument();
        expect(screen.queryByText(/Enviado/i)).not.toBeInTheDocument();
    });

    it('renders a newly scheduled Ruly reminder without exposing its IDs', () => {
        render(
            <CustomerReminderActions
                customer={customer()}
                reminder={reminder({ status: 'programado' })}
                cloudEnabled
                configEnabled
                canManage
                feedback={{ type: 'success', message: 'Recordatorio programado correctamente.' }}
            />
        );

        expect(screen.getByLabelText('Recordatorios de Ruly')).toBeVisible();
        expect(screen.getByText('Recordatorio programado correctamente.')).toBeVisible();
        expect(screen.queryByText('reminder-technical-id')).not.toBeInTheDocument();
        expect(screen.queryByText('customer-ruly')).not.toBeInTheDocument();
    });
});
