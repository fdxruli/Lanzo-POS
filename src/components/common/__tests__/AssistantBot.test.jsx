/* @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { ShoppingCart } from 'lucide-react';
import AssistantBot from '../AssistantBot';
import * as engine from '../../../utils/botIntelligence';
import { BotScreenProvider, usePublishBotScreen } from '../../../hooks/useBotScreenContext';

const mocks = vi.hoisted(() => ({ role: 'admin', allowed: true }));
vi.mock('../../../hooks/pos/useActiveOrders', () => ({ useActiveOrders: (fn) => fn({ activeOrders: new Map() }) }));
vi.mock('../../../store/useAppStore', () => ({ useAppStore: (fn) => fn({ companyProfile: { business_type: 'abarrotes' }, canAccess: () => mocks.allowed }) }));
vi.mock('../../../services/auth/useActorRuntimeSnapshot', () => ({ useActorRuntimeSnapshot: () => ({ generation: 1, actorType: mocks.role }) }));
const Location = () => { const location = useLocation(); const navigate = useNavigate(); return <><span data-testid="path">{location.pathname + location.search}</span><button onClick={() => navigate('/clientes?tab=add')}>Cambiar pantalla</button></>; };
const openBot = () => fireEvent.click(screen.getByRole('button', { name: 'Abrir Lanzó Bot' }));
const mount = (path = '/') => render(<MemoryRouter initialEntries={[path]}><Location /><AssistantBot /></MemoryRouter>);
beforeEach(() => { mocks.role = 'admin'; mocks.allowed = true; Element.prototype.scrollIntoView = vi.fn(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('AssistantBot question path', () => {
  it('suggestion → real engine → visible response without Worker support', async () => {
    vi.stubGlobal('Worker', undefined);
    mount(); openBot();
    fireEvent.click(screen.getByRole('button', { name: '¿Cómo hago una venta rápida?' }));
    expect(screen.getByRole('status')).toHaveTextContent('Procesando pregunta');
    expect(await screen.findByText('Venta rápida')).toBeVisible();
    expect(screen.getByText(/1. En Punto de venta/)).toBeVisible();
  });
  it('submits a manual question with Enter', async () => {
    const user = userEvent.setup(); mount(); openBot();
    await user.type(screen.getByRole('textbox'), '¿Cómo registro un abono?{Enter}');
    expect(await screen.findByText('Registrar abono')).toBeVisible();
    expect(screen.getByRole('textbox')).toHaveValue('');
  });
  it('ignores repeated submission while a request is running', async () => {
    let resolve;
    const spy = vi.spyOn(engine, 'processBotMessage').mockImplementation(() => new Promise(done => { resolve = done; }));
    mount(); openBot();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Hola' } });
    fireEvent.submit(screen.getByRole('textbox').closest('form'));
    fireEvent.submit(screen.getByRole('textbox').closest('form'));
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    await act(async () => resolve({ title: 'Respuesta única', message: 'Listo' }));
    expect(screen.getAllByText('Respuesta única')).toHaveLength(1);
  });
  it('shows an initialization error and recovers through Retry', async () => {
    vi.spyOn(engine, 'processBotMessage').mockRejectedValueOnce(new Error('Chunk unavailable'));
    mount(); openBot(); fireEvent.click(screen.getByRole('button', { name: '¿Cómo hago una venta rápida?' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Reintentar pregunta' }));
    expect(await screen.findByText('Venta rápida')).toBeVisible();
  });
  it('navigates from a response to an existing route and tab', async () => {
    mount(); openBot();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '¿Cómo agrego stock o un lote?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar pregunta' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Abrir Entradas de inventario' }));
    expect(screen.getByTestId('path')).toHaveTextContent('/productos?tab=batches');
  });
  it('discards a late response after navigation and updates suggestions', async () => {
    let resolve;
    vi.spyOn(engine, 'processBotMessage').mockImplementation(() => new Promise(done => { resolve = done; }));
    mount(); openBot(); fireEvent.click(screen.getByRole('button', { name: '¿Cómo hago una venta rápida?' }));
    await waitFor(() => expect(resolve).toBeTypeOf('function'));
    fireEvent.click(screen.getByRole('button', { name: 'Cambiar pantalla' }));
    await act(async () => resolve({ title: 'Respuesta vieja', message: 'Datos de la pantalla anterior' }));
    expect(screen.queryByText('Respuesta vieja')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '¿Cómo registro un cliente?' })).toBeVisible();
  });
  it('keeps operational help for Staff without reports and hides unauthorized links', async () => {
    mocks.role = 'staff'; mocks.allowed = false;
    render(<MemoryRouter><AssistantBot reportsAllowed={false} /></MemoryRouter>); openBot();
    fireEvent.click(screen.getByRole('button', { name: '¿Cómo hago una venta rápida?' }));
    expect(await screen.findByText('Venta rápida')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Abrir Venta rápida' })).not.toBeInTheDocument();
  });
  it('provides operational guidance offline and updates connection status', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    mount(); openBot(); fireEvent.click(screen.getByRole('button', { name: '¿Cómo hago una venta rápida?' }));
    expect(await screen.findByText('Venta rápida')).toBeVisible();
    expect(screen.getByText(/Sin conexión/)).toBeVisible();
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    fireEvent(window, new Event('online'));
    expect(screen.getByText(/Con conexión/)).toBeVisible();
  });
  it('uses a published local tab for Caja suggestions', () => {
    const Tab = () => { usePublishBotScreen('/caja', 'movimientos'); return null; };
    render(<MemoryRouter initialEntries={['/caja']}><BotScreenProvider><Tab /><AssistantBot /></BotScreenProvider></MemoryRouter>); openBot();
    expect(screen.getByRole('button', { name: '¿Cómo registro una entrada o salida?' })).toBeVisible();
    expect(screen.getByText('Caja · Movimientos')).toBeVisible();
  });
  it('confirms why the previous page icon failed structured clone', () => {
    expect(() => structuredClone({ page: { icon: ShoppingCart } })).toThrow();
  });
});
