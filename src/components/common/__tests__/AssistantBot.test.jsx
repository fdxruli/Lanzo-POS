/* @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { ShoppingCart } from 'lucide-react';
import AssistantBot from '../AssistantBot';
import { getBotScreen } from '../../../config/botKnowledge';
import * as engine from '../../../utils/botIntelligence';
import { GLOBAL_ALERT } from '../../../config/botContext';
import { BotScreenProvider, usePublishBotScreen } from '../../../hooks/useBotScreenContext';

const mocks = vi.hoisted(() => ({ role: 'admin', allowed: true }));
vi.mock('../../../hooks/pos/useActiveOrders', () => ({ useActiveOrders: (fn) => fn({ activeOrders: new Map() }) }));
vi.mock('../../../store/useAppStore', () => ({ useAppStore: (fn) => fn({ companyProfile: { business_type: 'abarrotes' }, canAccess: () => mocks.allowed }) }));
vi.mock('../../../services/auth/useActorRuntimeSnapshot', () => ({ useActorRuntimeSnapshot: () => ({ generation: 1, actorType: mocks.role }) }));
vi.mock('../../../services/auth/useSettingsAccess', () => ({
  useSettingsAccess: () => ({ canAccessSection: () => mocks.role === 'admin' || mocks.allowed })
}));
const Location = () => { const location = useLocation(); const navigate = useNavigate(); return <><span data-testid="path">{location.pathname + location.search}</span><button onClick={() => navigate('/clientes?tab=add')}>Cambiar pantalla</button></>; };
const openBot = () => fireEvent.click(screen.getByRole('button', { name: 'Abrir Lanzó Bot' }));
const mount = (path = '/') => render(<MemoryRouter initialEntries={[path]}><Location /><AssistantBot /></MemoryRouter>);
let workerCreations = 0;
let workerInstances = [];
class TestWorker {
  constructor() { workerCreations += 1; workerInstances.push(this); }
  listeners = new Map();
  addEventListener(type, fn) { this.listeners.set(type, fn); }
  removeEventListener(type) { this.listeners.delete(type); }
  terminate() { this.terminated = true; this.listeners.clear(); }
  postMessage(data) {
    Promise.resolve().then(async () => {
      const value = data.type === 'CONTEXT' ? getBotScreen(data.payload.pathname, data.payload.search, data.payload.tab) : await engine.processBotMessage(data.payload.text, data.payload.context);
      this.listeners.get('message')?.({ data: { id: data.id, type: 'RESULT', value } });
    }).catch(() => this.listeners.get('error')?.({}));
  }
}
beforeEach(() => { workerCreations = 0; workerInstances = []; vi.stubGlobal('Worker', TestWorker); mocks.role = 'admin'; mocks.allowed = true; Element.prototype.scrollIntoView = vi.fn(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('AssistantBot question path', () => {
  it('uses the floating launcher as the only normal close and restores focus after Escape', async () => {
    vi.stubGlobal('requestAnimationFrame', callback => setTimeout(callback, 0));
    mount(); openBot();
    expect(screen.getByRole('heading', { name: 'Lanzó Bot' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Cerrar asistente' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cerrar Lanzó Bot' })).toBeVisible();
    const panel = screen.getByRole('region', { name: 'Lanzó Bot' });
    fireEvent.keyDown(panel, { key: 'Escape', code: 'Escape' });
    const launcher = screen.getByRole('button', { name: 'Abrir Lanzó Bot' });
    expect(launcher).toBeVisible();
    await waitFor(() => expect(launcher).toHaveFocus());
    await waitFor(() => expect(workerInstances[0].terminated).toBe(true));
    fireEvent.click(launcher);
    expect(screen.getByRole('button', { name: 'Cerrar Lanzó Bot' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar Lanzó Bot' }));
    expect(screen.getByRole('button', { name: 'Abrir Lanzó Bot' })).toBeVisible();
    await waitFor(() => expect(workerInstances[1].terminated).toBe(true));
  });

  it('offers a temporary header close only when the Android visual viewport indicates keyboard', async () => {
    vi.stubGlobal('requestAnimationFrame', callback => setTimeout(callback, 0));
    vi.stubGlobal('innerHeight', 844);
    const handlers = new Map();
    const viewport = {
      height: 844, offsetTop: 0,
      addEventListener(type, callback) { handlers.set(type, callback); },
      removeEventListener(type) { handlers.delete(type); }
    };
    vi.stubGlobal('visualViewport', viewport);
    mount('/productos?tab=batches'); openBot();
    expect(await screen.findByText('Productos e inventario · Gestionar lotes')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Cerrar asistente' })).not.toBeInTheDocument();
    act(() => { viewport.height = 480; handlers.get('resize')(); });
    expect(document.querySelector('.lanzo-bot-container')).toHaveClass('keyboard-open');
    expect(document.querySelector('.lanzo-bot-container').style.getPropertyValue('--bot-keyboard-inset')).toBe('364px');
    expect(screen.getByRole('button', { name: 'Cerrar asistente' })).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Pregunta para el asistente' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Enviar pregunta' })).toBeInTheDocument();
    act(() => { viewport.height = 844; handlers.get('resize')(); });
    expect(screen.queryByRole('button', { name: 'Cerrar asistente' })).not.toBeInTheDocument();
    act(() => { viewport.height = 480; handlers.get('resize')(); });
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar asistente' }));
    expect(screen.getByRole('button', { name: 'Abrir Lanzó Bot' })).toBeVisible();
    await waitFor(() => expect(workerInstances[0].terminated).toBe(true));
  });

  it('keeps the full long section title available in the compact header', async () => {
    mount('/productos?tab=batches'); openBot();
    const context = await screen.findByText('Productos e inventario · Gestionar lotes');
    expect(context).toHaveAttribute('title', 'Productos e inventario · Gestionar lotes');
    expect(context).toHaveClass('bot-subtitle');
    expect(screen.queryByRole('button', { name: 'Cerrar asistente' })).not.toBeInTheDocument();
  });

  it('keeps the legacy close for a dismissible global notice without a floating launcher', () => {
    render(<MemoryRouter><AssistantBot enabled={false} globalAlertEligible /></MemoryRouter>);
    expect(workerCreations).toBe(0);
    expect(screen.queryByRole('button', { name: 'Abrir Lanzó Bot' })).not.toBeInTheDocument();
    const close = screen.getByRole('button', { name: 'Cerrar asistente' });
    expect(close).toBeEnabled();
    fireEvent.click(close);
    expect(screen.queryByRole('region', { name: 'Lanzó Bot' })).not.toBeInTheDocument();
    expect(workerCreations).toBe(0);
  });

  it('blocks Escape and the header close for critical notices', () => {
    const before = { severity: GLOBAL_ALERT.severity, isDismissible: GLOBAL_ALERT.isDismissible };
    try {
      GLOBAL_ALERT.severity = 'critical';
      GLOBAL_ALERT.isDismissible = false;
      render(<MemoryRouter><AssistantBot enabled={false} globalAlertEligible /></MemoryRouter>);
      expect(screen.queryByRole('button', { name: 'Abrir Lanzó Bot' })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Cerrar asistente' })).toBeDisabled();
      fireEvent.keyDown(screen.getByRole('region', { name: 'Lanzó Bot' }), { key: 'Escape', code: 'Escape' });
      expect(screen.getByRole('region', { name: 'Lanzó Bot' })).toBeVisible();
      expect(workerCreations).toBe(0);
    } finally {
      Object.assign(GLOBAL_ALERT, before);
    }
  });
  it('shows compact contextual help and authorized navigation without requesting data', async () => {
    mount(); openBot();
    expect(await screen.findByText(/Desde aquí puedes buscar o escanear productos/)).toBeVisible();
    expect(screen.getByText('¿Qué puedes hacer aquí?')).toBeVisible();
    expect(screen.getByText('Accesos rápidos')).toBeVisible();
    expect(screen.getByText('Preguntas sugeridas')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Ir a Crear un producto' })).toBeVisible();
    expect(workerCreations).toBe(1);
    fireEvent.click(screen.getByRole('button', { name: 'Ir a Crear un producto' }));
    expect(screen.getByTestId('path')).toHaveTextContent('/productos?tab=add');
    expect(screen.getByRole('button', { name: 'Abrir Lanzó Bot' })).toBeVisible();
  });
  it('does not show quick actions when the current actor lacks navigation permission', async () => {
    mocks.role = 'staff'; mocks.allowed = false;
    mount(); openBot();
    expect(await screen.findByText(/Desde aquí puedes buscar o escanear productos/)).toBeVisible();
    expect(screen.queryByText('Accesos rápidos')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '¿Cómo hago una venta rápida?' })).toBeVisible();
  });
  it('prioritizes conversation while allowing users to return to the contextual tools', async () => {
    mount(); openBot();
    fireEvent.click(await screen.findByRole('button', { name: '¿Cómo hago una venta rápida?' }));
    expect(await screen.findByText('Venta rápida')).toBeVisible();
    expect(screen.queryByText('Accesos rápidos')).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Pregunta para el asistente' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Ver accesos y preguntas' }));
    expect(screen.getByText('Accesos rápidos')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Volver a la conversación' }));
    expect(screen.getByText('Venta rápida')).toBeVisible();
  });
  it('uses a specific contextual description when the route has a tab', async () => {
    mount('/productos?tab=batches'); openBot();
    expect(await screen.findByText(/Gestionar lotes, busca y selecciona el producto/)).toBeVisible();
    expect(screen.getByText('Productos e inventario · Gestionar lotes')).toBeVisible();
  });
  it('does not create an engine while disabled, including global safety notices', () => {
    render(<MemoryRouter><AssistantBot enabled={false} globalAlertEligible /></MemoryRouter>);
    expect(screen.getByRole('button', { name: 'Entendido' })).toBeVisible();
    expect(workerCreations).toBe(0);
  });
  it('does not create a worker for the closed launcher', () => {
    mount(); expect(screen.getByRole('button', { name: 'Abrir Lanzó Bot' })).toBeVisible(); expect(workerCreations).toBe(0);
  });

  it('suggestion → worker client → visible response (transport fixture)', async () => {
    mount(); openBot();
    fireEvent.click(await screen.findByRole('button', { name: '¿Cómo hago una venta rápida?' }));
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
    mount(); openBot(); fireEvent.click(await screen.findByRole('button', { name: '¿Cómo hago una venta rápida?' }));
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
    mount(); openBot(); fireEvent.click(await screen.findByRole('button', { name: '¿Cómo hago una venta rápida?' }));
    await waitFor(() => expect(resolve).toBeTypeOf('function'));
    fireEvent.click(screen.getByRole('button', { name: 'Cambiar pantalla' }));
    await act(async () => resolve({ title: 'Respuesta vieja', message: 'Datos de la pantalla anterior' }));
    expect(screen.queryByText('Respuesta vieja')).not.toBeInTheDocument();
    expect(await screen.findByRole('button', { name: '¿Cómo registro un cliente?' })).toBeVisible();
  });
  it('keeps operational help for Staff without reports and hides unauthorized links', async () => {
    mocks.role = 'staff'; mocks.allowed = false;
    render(<MemoryRouter><AssistantBot reportsAllowed={false} /></MemoryRouter>); openBot();
    fireEvent.click(await screen.findByRole('button', { name: '¿Cómo hago una venta rápida?' }));
    expect(await screen.findByText('Venta rápida')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Abrir Venta rápida' })).not.toBeInTheDocument();
  });
  it('provides operational guidance offline and updates connection status', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    mount(); openBot(); fireEvent.click(await screen.findByRole('button', { name: '¿Cómo hago una venta rápida?' }));
    expect(await screen.findByText('Venta rápida')).toBeVisible();
    expect(screen.getByText(/Sin conexión/)).toBeVisible();
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    fireEvent(window, new Event('online'));
    expect(screen.getByText(/Con conexión/)).toBeVisible();
  });
  it('uses a published local tab for Caja suggestions', async () => {
    const Tab = () => { usePublishBotScreen('/caja', 'movimientos'); return null; };
    render(<MemoryRouter initialEntries={['/caja']}><BotScreenProvider><Tab /><AssistantBot /></BotScreenProvider></MemoryRouter>); openBot();
    expect(await screen.findByRole('button', { name: '¿Cómo registro una entrada o salida?' })).toBeVisible();
    expect(screen.getByText('Caja · Movimientos')).toBeVisible();
  });
  it('confirms why the previous page icon failed structured clone', () => {
    expect(() => structuredClone({ page: { icon: ShoppingCart } })).toThrow();
  });
});
