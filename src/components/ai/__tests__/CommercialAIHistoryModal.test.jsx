// @vitest-environment jsdom
import { StrictMode, useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CommercialAIHistoryModal from '../CommercialAIHistoryModal';

function Fixture() {
  const [open, setOpen] = useState(false);
  return <div className="content-wrapper" style={{ overflow: 'auto' }}>
    <button onClick={() => setOpen(true)}>Abrir</button>
    {open && <CommercialAIHistoryModal count={1} onClose={() => setOpen(false)}>
      <p id="commercial-ai-history-privacy">Datos de prueba locales.</p>
      <button>Ver respuesta</button>
      <details><summary>Metadatos</summary><button>Control oculto</button></details>
      <button hidden>Otro control oculto</button>
      <input aria-label="Filtro de prueba" />
    </CommercialAIHistoryModal>}
  </div>;
}

afterEach(cleanup);

describe('history modal lifecycle', () => {
  it('traps forward and reverse Tab, excludes collapsed details, and contains programmatic focus', async () => {
    const user = userEvent.setup();
    render(<Fixture />);
    const opener = screen.getByRole('button', { name: 'Abrir' });
    await user.click(opener);
    const dialog = screen.getByRole('dialog', { name: 'Historial de consultas' });
    const close = within(dialog).getByRole('button', { name: 'Cerrar historial' });
    expect(close).toHaveFocus();
    await user.tab({ shift: true });
    expect(within(dialog).getByRole('textbox')).toHaveFocus();
    await user.tab();
    expect(close).toHaveFocus();
    await user.tab();
    expect(within(dialog).getByRole('button', { name: 'Ver respuesta' })).toHaveFocus();
    await user.tab();
    expect(within(dialog).getByText('Metadatos')).toHaveFocus();
    await user.tab();
    expect(within(dialog).getByRole('textbox')).toHaveFocus();
    opener.focus();
    expect(close).toHaveFocus();
  });

  it('restores exact inline scroll and inert states when closed or unmounted in StrictMode', async () => {
    const user = userEvent.setup();
    const originalOverflow = document.body.style.overflow;
    document.body.style.setProperty('overflow', 'clip', 'important');
    const view = render(<StrictMode><Fixture /></StrictMode>);
    const scroller = view.container.querySelector('.content-wrapper');
    scroller.scrollTop = 140;
    const opener = screen.getByRole('button', { name: 'Abrir' });
    await user.click(opener);
    expect(scroller.style.overflow).toBe('hidden');
    expect(view.container).toHaveAttribute('inert');
    await user.keyboard('{Escape}');
    expect(scroller.style.overflow).toBe('auto');
    expect(scroller.scrollTop).toBe(140);
    expect(document.body.style.overflow).toBe('clip');
    expect(document.body.style.getPropertyPriority('overflow')).toBe('important');
    expect(view.container).not.toHaveAttribute('inert');
    expect(opener).toHaveFocus();
    await user.click(opener);
    view.unmount();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.body.style.overflow).toBe('clip');
    document.body.style.overflow = originalOverflow;
  });

  it('retains existing inert attributes and does not dismiss from a backdrop click', () => {
    const previousLayer = document.createElement('div');
    previousLayer.setAttribute('inert', '');
    previousLayer.setAttribute('aria-hidden', 'false');
    document.body.appendChild(previousLayer);
    const view = render(<Fixture />);
    fireEvent.click(screen.getByRole('button', { name: 'Abrir' }));
    expect(previousLayer).toHaveAttribute('aria-hidden', 'true');
    fireEvent.mouseDown(document.querySelector('.commercial-ai-history-backdrop'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar historial' }));
    expect(previousLayer).toHaveAttribute('inert');
    expect(previousLayer).toHaveAttribute('aria-hidden', 'false');
    view.unmount();
    previousLayer.remove();
  });
});
