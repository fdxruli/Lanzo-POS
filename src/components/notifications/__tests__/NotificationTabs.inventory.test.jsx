// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import NotificationTabs from '../NotificationTabs';

afterEach(cleanup);

describe('NotificationTabs inventory category', () => {
  it('places Inventario between Pedidos online and Operaciones', () => {
    render(
      <NotificationTabs
        activeTab="all"
        onTabChange={vi.fn()}
        showSupport
        showInventory
        counts={{ inventory: 10, operations: 3 }}
      />
    );

    const labels = screen.getAllByRole('tab').map((tab) => tab.textContent);
    expect(labels).toEqual([
      'Todas',
      'No leídas',
      'Soporte',
      'Pedidos online',
      'Inventario10',
      'Operaciones3',
      'Licencia',
      'Sistema'
    ]);
  });

  it('hides Inventory completely for unauthorized Staff', () => {
    render(
      <NotificationTabs
        activeTab="all"
        onTabChange={vi.fn()}
        showSupport
        showInventory={false}
        counts={{ inventory: 10, operations: 3 }}
      />
    );

    expect(screen.queryByRole('tab', { name: /Inventario/ })).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Operaciones/ })).toBeInTheDocument();
  });

  it('hides each category the current user cannot consult', () => {
    render(
      <NotificationTabs
        activeTab="all"
        onTabChange={vi.fn()}
        categoryAccess={{ ecommerce: false, license: false, system: false }}
        counts={{ ecommerce: 2, license: 1, system: 3 }}
      />
    );

    expect(screen.queryByRole('tab', { name: /Pedidos online/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /Licencia/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /Sistema/ })).not.toBeInTheDocument();
  });

  it('requests only the inventory key when Inventory is clicked', () => {
    const onTabChange = vi.fn();
    render(
      <NotificationTabs
        activeTab="all"
        onTabChange={onTabChange}
        showSupport
        showInventory
        counts={{ inventory: 10 }}
      />
    );

    fireEvent.click(screen.getByRole('tab', { name: /Inventario/ }));
    expect(onTabChange).toHaveBeenCalledWith('inventory');
  });

  it('moves between categories with the horizontal arrow keys', () => {
    const onTabChange = vi.fn();
    render(<NotificationTabs activeTab="all" onTabChange={onTabChange} />);

    const allTab = screen.getByRole('tab', { name: /^Todas/ });
    fireEvent.keyDown(allTab, { key: 'ArrowRight' });

    expect(onTabChange).toHaveBeenCalledWith('unread');
    expect(screen.getByRole('tab', { name: /No leídas/ })).toHaveFocus();
  });
});
