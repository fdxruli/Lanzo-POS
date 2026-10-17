// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';

vi.mock('lucide-react', () => {
  const Icon = (props) => React.createElement('svg', props);
  return { AlertTriangle: Icon, RefreshCw: Icon, TrendingUp: Icon, TrendingDown: Icon };
});

vi.mock('recharts', () => {
  const ThrowsDuringRender = () => { throw new Error('synthetic chart failure'); };
  const Wrapper = ({ children }) => React.createElement('div', null, children);
  return {
    AreaChart: ThrowsDuringRender,
    Area: () => null,
    BarChart: Wrapper,
    Bar: () => null,
    XAxis: () => null,
    YAxis: () => null,
    CartesianGrid: () => null,
    Tooltip: () => null,
    ResponsiveContainer: Wrapper
  };
});

import { AreaTrendChart } from '../TrendChart';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('local chart incident recovery', () => {
  it('keeps the dashboard visible and limits recovery to one chart retry', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <>
        <header>Lanzo dashboard</header>
        <AreaTrendChart data={[{ name: 'Hoy', value: 12 }]} />
        <section>Resumen de ventas disponible</section>
      </>
    );

    expect(screen.getByText('Lanzo dashboard')).toBeInTheDocument();
    expect(screen.getByText('Resumen de ventas disponible')).toBeInTheDocument();
    expect(screen.getByText('No pudimos cargar esta información')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));

    expect(screen.getByText('Lanzo dashboard')).toBeInTheDocument();
    expect(screen.getByText('Resumen de ventas disponible')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reintento utilizado' })).toBeDisabled();
  });
});
