import { useState } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import {
  createMemoryRouter,
  Link,
  RouterProvider,
  useLocation,
  useNavigate
} from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import MessageModal from '../../components/common/MessageModal';
import { useMessageStore } from '../../store/useMessageStore';
import { useNavigationGuard } from '../useNavigationGuard';

function GuardHarness({ enabled = true, onDiscard = vi.fn() }) {
  const [name, setName] = useState('');
  const navigate = useNavigate();
  const { runWithoutBlocking } = useNavigationGuard({
    enabled,
    title: '¿Salir del formulario?',
    message: 'Datos de producto sin guardar.',
    confirmButtonText: 'Sí, salir',
    cancelButtonText: 'Continuar editando',
    onDiscard
  });

  return (
    <>
      <label htmlFor="product-name">Nombre</label>
      <input
        id="product-name"
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      <Link to="/next">Ir a otra sección</Link>
      <Link to="/?tab=list">Cambiar pestaña</Link>
      <button
        type="button"
        onClick={() => runWithoutBlocking(() => navigate('/saved'))}
      >
        Guardar y salir
      </button>
      <MessageModal />
    </>
  );
}

function TabGuardHarness({ onDiscard = vi.fn() }) {
  const location = useLocation();
  const enabled = location.search !== '?tab=list';

  useNavigationGuard({
    enabled,
    title: 'Â¿Salir del formulario?',
    message: 'Datos de producto sin guardar.',
    confirmButtonText: 'SÃ­, salir',
    cancelButtonText: 'Continuar editando',
    onDiscard
  });

  return (
    <>
      <Link to="/?tab=list">Ver lista</Link>
      <div>{enabled ? 'Formulario activo' : 'Lista de productos'}</div>
      <MessageModal />
    </>
  );
}

function renderGuard(options = {}, routerOptions = {}) {
  const router = createMemoryRouter([
    {
      path: '/',
      element: <GuardHarness {...options} />
    },
    {
      path: '/next',
      element: <div>Otra sección</div>
    },
    {
      path: '/saved',
      element: <div>Producto guardado</div>
    },
    {
      path: '/previous',
      element: <div>Sección anterior</div>
    }
  ], routerOptions);

  return {
    router,
    ...render(<RouterProvider router={router} />)
  };
}

function renderTabGuard(options = {}, routerOptions = {}) {
  const router = createMemoryRouter([
    {
      path: '/',
      element: <TabGuardHarness {...options} />
    }
  ], {
    initialEntries: ['/?tab=add'],
    ...routerOptions
  });

  return {
    router,
    ...render(<RouterProvider router={router} />)
  };
}

beforeEach(() => {
  useMessageStore.setState({
    isOpen: false,
    message: '',
    onConfirm: null,
    options: {}
  });
});

describe('useNavigationGuard', () => {
  it('bloquea la navegación aunque el formulario no haya cambiado', async () => {
    const user = userEvent.setup();
    const { router } = renderGuard();

    await user.click(screen.getByRole('link', { name: 'Ir a otra sección' }));

    expect(router.state.location.pathname).toBe('/');
    expect(screen.getByText('¿Salir del formulario?')).toBeInTheDocument();
    expect(screen.getByText('Datos de producto sin guardar.')).toBeInTheDocument();
  });

  it('cancela la salida y conserva los datos capturados', async () => {
    const user = userEvent.setup();
    const { router } = renderGuard();
    const input = screen.getByLabelText('Nombre');

    await user.type(input, 'Café molido');
    await user.click(screen.getByRole('link', { name: 'Ir a otra sección' }));
    await user.click(screen.getByRole('button', { name: 'Continuar editando' }));

    expect(router.state.location.pathname).toBe('/');
    expect(input).toHaveValue('Café molido');
    expect(screen.queryByText('¿Salir del formulario?')).not.toBeInTheDocument();
  });

  it('descarta la operación y continúa al destino al confirmar', async () => {
    const user = userEvent.setup();
    const onDiscard = vi.fn();
    const { router } = renderGuard({ onDiscard });

    await user.click(screen.getByRole('link', { name: 'Ir a otra sección' }));
    await user.click(screen.getByRole('button', { name: 'Sí, salir' }));

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/next');
    });
    expect(onDiscard).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Otra sección')).toBeInTheDocument();
  });

  it('permite navegar sin advertencia después de guardar', async () => {
    const user = userEvent.setup();
    const { router } = renderGuard();

    await user.click(screen.getByRole('button', { name: 'Guardar y salir' }));

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/saved');
    });
    expect(screen.queryByText('¿Salir del formulario?')).not.toBeInTheDocument();
  });

  it('activa la advertencia nativa del navegador mientras está habilitado', () => {
    renderGuard();
    const event = new Event('beforeunload', { cancelable: true });

    fireEvent(window, event);

    expect(event.defaultPrevented).toBe(true);
  });

  it('bloquea cambios de pestaña representados por parámetros de búsqueda', async () => {
    const user = userEvent.setup();
    const { router } = renderGuard();

    await user.click(screen.getByRole('link', { name: 'Cambiar pestaña' }));

    expect(router.state.location.search).toBe('');
    expect(screen.getByText('¿Salir del formulario?')).toBeInTheDocument();
  });

  it('cierra el modal al confirmar salida hacia otra pestaña de la misma ruta', async () => {
    const user = userEvent.setup();
    const onDiscard = vi.fn();
    const { router } = renderTabGuard({ onDiscard });

    await user.click(screen.getByRole('link', { name: 'Ver lista' }));
    await user.click(screen.getByRole('button', { name: /salir/i }));

    await waitFor(() => {
      expect(router.state.location.search).toBe('?tab=list');
    });
    expect(onDiscard).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Lista de productos')).toBeInTheDocument();
    expect(screen.queryByText(/Salir del formulario/)).not.toBeInTheDocument();
  });

  it('bloquea la navegación hacia atrás del historial', async () => {
    const { router } = renderGuard({}, {
      initialEntries: ['/previous', '/'],
      initialIndex: 1
    });

    await act(async () => {
      await router.navigate(-1);
    });

    expect(router.state.location.pathname).toBe('/');
    expect(screen.getByText('¿Salir del formulario?')).toBeInTheDocument();
  });
});
