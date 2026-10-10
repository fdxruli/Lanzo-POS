// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ props: null, confirm: vi.fn(), message: vi.fn() }));
vi.mock('../../../services/utils', () => ({ showConfirmModal: mocks.confirm, showMessageModal: mocks.message }));
vi.mock('../CloudKitchenMonitorRest8', () => ({ default: props => { mocks.props = props; return null; } }));
import Container from '../CloudKitchenMonitorRest8Container';

describe('Kitchen rejection has no parent cancellation authority', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.confirm.mockResolvedValue(true); });
  it('rejects eligible products through the existing item contract', async () => {
    const kitchenCloud = { changeOrderItemStatus: vi.fn().mockResolvedValue({ success: true }), changeOrderStatus: vi.fn() };
    render(<Container kitchenCloud={kitchenCloud} />);
    await mocks.props.onCancelOrder({ id: 'parent', items: [{ id: 'a', status: 'pending' }, { id: 'b', status: 'preparing' }] });
    expect(kitchenCloud.changeOrderItemStatus).toHaveBeenCalledTimes(2);
    expect(kitchenCloud.changeOrderStatus).not.toHaveBeenCalled();
    expect(mocks.message).toHaveBeenLastCalledWith(expect.stringContaining('mesa sigue abierta'), null, { type: 'success' });
  });
  it('does not reinterpret ready products as an authorized parent cancellation', async () => {
    const kitchenCloud = { changeOrderItemStatus: vi.fn(), changeOrderStatus: vi.fn() };
    render(<Container kitchenCloud={kitchenCloud} />);
    await mocks.props.onCancelOrder({ id: 'parent', items: [{ id: 'a', status: 'ready' }] });
    expect(kitchenCloud.changeOrderItemStatus).not.toHaveBeenCalled();
    expect(kitchenCloud.changeOrderStatus).not.toHaveBeenCalled();
  });
  it('reports partial rejection without claiming the parent was cancelled', async () => {
    const kitchenCloud = { changeOrderItemStatus: vi.fn().mockResolvedValueOnce({ success: true }).mockResolvedValueOnce({ success: false }), changeOrderStatus: vi.fn() };
    render(<Container kitchenCloud={kitchenCloud} />);
    await mocks.props.onCancelOrder({ id: 'parent', items: [{ id: 'a', status: 'pending' }, { id: 'b', status: 'pending' }] });
    expect(kitchenCloud.changeOrderStatus).not.toHaveBeenCalled();
    expect(mocks.message).toHaveBeenLastCalledWith(expect.stringContaining('Actualiza cocina'), null, { type: 'warning' });
  });
});
