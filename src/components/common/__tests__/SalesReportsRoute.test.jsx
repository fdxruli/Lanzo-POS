// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ runtime: null }));

vi.mock('../../../services/auth/useActorRuntimeSnapshot', () => ({
  useActorRuntimeSnapshot: () => state.runtime
}));

vi.mock('../NoPermission', () => ({
  default: () => <div>No permission</div>
}));

import SalesReportsRoute from '../SalesReportsRoute';

const staffRuntime = (permissions, status = 'granted') => ({
  status,
  actorType: 'staff',
  actorId: 'staff-1',
  sessionId: 'staff-session-1',
  permissions
});

function HistoryControls() {
  const navigate = useNavigate();
  return (
    <>
      <button type="button" onClick={() => navigate(-1)}>Back</button>
      <button type="button" onClick={() => navigate(1)}>Forward</button>
    </>
  );
}

beforeEach(() => {
  state.runtime = staffRuntime(['reports']);
});

afterEach(() => cleanup());

describe('SalesReportsRoute', () => {
  it('allows reports without requiring refunds', () => {
    render(<SalesReportsRoute><div>Sales history</div></SalesReportsRoute>);
    expect(screen.getByText('Sales history')).toBeInTheDocument();
  });

  it('does not infer report reads from refunds', () => {
    state.runtime = staffRuntime(['refunds']);
    render(<SalesReportsRoute><div>Sales history</div></SalesReportsRoute>);
    expect(screen.getByText('No permission')).toBeInTheDocument();
    expect(screen.queryByText('Sales history')).not.toBeInTheDocument();
  });

  it('fails closed during an actor handoff', () => {
    state.runtime = staffRuntime(['reports'], 'handoff_check');
    render(<SalesReportsRoute><div>Sales history</div></SalesReportsRoute>);
    expect(screen.getByText('No permission')).toBeInTheDocument();
  });

  it('keeps Back and Forward fail closed after reports authority is lost', () => {
    const renderHistory = () => (
      <MemoryRouter initialEntries={['/', '/ventas']} initialIndex={1}>
        <HistoryControls />
        <Routes>
          <Route path="/" element={<div>Safe home</div>} />
          <Route
            path="/ventas"
            element={<SalesReportsRoute><div>Sales history</div></SalesReportsRoute>}
          />
        </Routes>
      </MemoryRouter>
    );
    const view = render(renderHistory());
    expect(screen.getByText('Sales history')).toBeInTheDocument();

    state.runtime = staffRuntime(['refunds']);
    view.rerender(renderHistory());
    expect(screen.getByText('No permission')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByText('Safe home')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Forward' }));
    expect(screen.getByText('No permission')).toBeInTheDocument();
    expect(screen.queryByText('Sales history')).not.toBeInTheDocument();
  });
});
