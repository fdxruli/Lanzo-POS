// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const ownership = vi.hoisted(() => ({ duplicate: null }));
vi.mock('../../hooks/useSingleInstance', () => ({
  useSingleInstance: () => ownership.duplicate
}));

import SingleInstanceGate from './SingleInstanceGate';

afterEach(cleanup);

describe('SingleInstanceGate: block runtime before bootstrap', () => {
  it('does not mount operational children before the window owns the instance', () => {
    const renderChild = vi.fn(() => <p>POS operativo</p>);
    const Child = () => renderChild();
    const view = () => <SingleInstanceGate><Child /></SingleInstanceGate>;

    ownership.duplicate = null;
    const { rerender } = render(view());
    expect(screen.getByText(/Comprobando ventana activa/)).toBeTruthy();
    expect(renderChild).not.toHaveBeenCalled();

    ownership.duplicate = true;
    rerender(view());
    expect(screen.getByText('Aplicación ya abierta')).toBeTruthy();
    expect(renderChild).not.toHaveBeenCalled();

    ownership.duplicate = false;
    rerender(view());
    expect(screen.getByText('POS operativo')).toBeTruthy();
    expect(renderChild).toHaveBeenCalledTimes(1);
  });
});
