import { describe, expect, it, vi } from 'vitest';
import { readCashSessionHistory } from './cashHistoryReader';

const handle = (actorKey = 'staff:test') => ({ actorKey, assertCurrent: vi.fn() });
const session = (id, actorKey = 'staff:test') => ({ id, actor_key: actorKey });
const page = (cash_sessions, extra = {}) => ({
  success: true, scope: 'mine', snapshot_contract: 'keyset_reference_v1',
  snapshot_contract_version: 1, snapshot_reference_change_seq: 45,
  has_more: false, snapshot_complete: true, next_page_cursor: null,
  cash_sessions, movements: [], ...extra
});

describe('cash history read-only keyset traversal', () => {
  it('reads 501 unique sessions with stable reference and stops at the movement partition', async () => {
    const first = Array.from({ length: 500 }, (_, index) => session(`s-${index}`));
    const cursor = { position_rank: 1, position_id: 's-499' };
    const fetchPage = vi.fn()
      .mockResolvedValueOnce(page(first, { has_more: true, snapshot_complete: false, next_page_cursor: cursor }))
      .mockResolvedValueOnce(page([session('s-500')], {
        movements: [{ id: 'movement-1' }], has_more: true, snapshot_complete: false,
        next_page_cursor: { position_rank: 2, position_id: 'movement-1' }
      }));
    const result = await readCashSessionHistory({ scope: 'mine', fetchPage, actorHandle: handle() });
    expect(result.sessions).toHaveLength(501);
    expect(new Set(result.sessions.map(row => row.id)).size).toBe(501);
    expect(fetchPage.mock.calls).toEqual([
      [{ referenceChangeSeq: null, pageCursor: null }],
      [{ referenceChangeSeq: 45, pageCursor: cursor }]
    ]);
    expect(result.referenceChangeSeq).toBe(45);
  });

  it('rejects a foreign actor in mine scope while allowing authorized all scope', async () => {
    const foreign = session('other', 'admin:other');
    await expect(readCashSessionHistory({
      scope: 'mine', actorHandle: handle(), fetchPage: async () => page([foreign])
    })).rejects.toThrow('CASH_HISTORY_SESSION_INVALID');
    await expect(readCashSessionHistory({
      scope: 'all', actorHandle: handle('admin:test'),
      fetchPage: async () => page([foreign], { scope: 'all' })
    })).resolves.toMatchObject({ sessions: [foreign] });
  });

  it('rejects changed references, duplicate sessions and unavailable Cloud', async () => {
    const cursor = { position_rank: 1, position_id: 'first' };
    const first = page([session('first')], { has_more: true, snapshot_complete: false, next_page_cursor: cursor });
    for (const [second, code] of [
      [page([session('second')], { snapshot_reference_change_seq: 46 }), 'CASH_HISTORY_REFERENCE_CHANGED'],
      [page([session('first')]), 'CASH_HISTORY_SESSION_INVALID'],
      [{ success: false, code: 'RPC_RATE_LIMITED' }, 'RPC_RATE_LIMITED']
    ]) {
      const fetchPage = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second);
      await expect(readCashSessionHistory({ scope: 'mine', fetchPage, actorHandle: handle() })).rejects.toThrow(code);
    }
  });

  it('does not return a page after actor authority changes', async () => {
    const actorHandle = handle();
    actorHandle.assertCurrent.mockImplementationOnce(() => {}).mockImplementationOnce(() => {
      throw new Error('ACTOR_CONTEXT_STALE');
    });
    await expect(readCashSessionHistory({
      scope: 'mine', actorHandle, fetchPage: async () => page([session('s-1')])
    })).rejects.toThrow('ACTOR_CONTEXT_STALE');
  });
});
