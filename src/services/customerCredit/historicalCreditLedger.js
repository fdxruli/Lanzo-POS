import { Money } from '../../utils/moneyMath';

// The confirmed Cloud INITIAL_BALANCE represents the captured Local history.
// Keep every original row; exclude its captured identity only from arithmetic.
export const historicalCreditLedgerView = (movements, snapshot) => {
  const receipt = snapshot?.result;
  const confirmed = ['IMPORTED', 'ALREADY_IMPORTED_IDENTICAL'].includes(receipt?.cloudStatus || receipt?.status);
  if (!confirmed || !receipt.ledger_id) return { active: movements, baselineCents: 0, representedIds: new Set(), confirmed: false };
  if (!Array.isArray(snapshot.originalLedgerEntries)) throw new Error('HISTORICAL_LEDGER_REVIEW_REQUIRED');
  const representedIds = new Set(snapshot.originalLedgerEntries.map((row) => row.id));
  const active = movements.filter((row) => !representedIds.has(row.id));
  const initial = active.find((row) => row.id === receipt.ledger_id);
  if (initial && (initial.type !== 'INITIAL_BALANCE' || Money.toCents(initial.amount) !== snapshot.amountCents)) {
    throw new Error('HISTORICAL_LEDGER_RECEIPT_MISMATCH');
  }
  // A confirmed receipt can arrive before the ledger pull, including offline.
  return { active, representedIds, baselineCents: initial ? 0 : snapshot.amountCents, confirmed: true };
};
