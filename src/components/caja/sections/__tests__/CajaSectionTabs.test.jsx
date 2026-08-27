// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import CajaSectionTabs from '../CajaSectionTabs';

afterEach(cleanup);

describe('CajaSectionTabs', () => {
  it('exposes tab semantics and supports arrow-key section navigation', () => {
    const onChange = vi.fn();
    render(<CajaSectionTabs
      sections={[{ id: 'turno', label: 'Turno' }, { id: 'historial', label: 'Historial' }]}
      activeSection="turno"
      onChange={onChange}
    />);

    expect(screen.getByRole('tablist')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Turno' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Turno' })).toHaveAttribute('aria-controls', 'caja-section-turno');

    const turnoTab = screen.getByRole('tab', { name: 'Turno' });
    turnoTab.focus();
    fireEvent.keyDown(turnoTab, { key: 'ArrowRight' });

    expect(onChange).toHaveBeenCalledWith('historial');
    expect(screen.getByRole('tab', { name: 'Historial' })).toHaveFocus();
  });
});
