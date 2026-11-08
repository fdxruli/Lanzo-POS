// A checkout confirmation is scoped to one captured cart, actor and attempt.
// This is a client acknowledgement, not a bypass of inventory/RLS checks.
const snapshotOf = ({ order, total, paymentData, saleId, attemptId, actorContext }) => JSON.stringify({
  order, total: String(total), saleId, attemptId,
  actorKey: actorContext?.actorKey || null,
  tenant: actorContext?.tenant?.opaqueId || null,
  payment: {
    paymentMethod: paymentData?.paymentMethod,
    amountPaid: paymentData?.amountPaid,
    saldoPendiente: paymentData?.saldoPendiente,
    customerId: paymentData?.customerId,
    cashSessionId: paymentData?.cashSessionId,
    saleDiscount: paymentData?.saleDiscount || null
  }
});
export const captureDirectPartialAuthorization = (context, shortages) => ({
  version: 1,
  saleId: context.saleId,
  attemptId: context.attemptId,
  actorKey: context.actorContext?.actorKey || null,
  tenant: context.actorContext?.tenant?.opaqueId || null,
  exactSnapshot: snapshotOf(context),
  maxMissing: Object.fromEntries(shortages.map((row) => [row.ingredientId, row.missing]))
});
export const matchesDirectPartialAuthorization = (approval, context) => (
  approval?.version === 1
  && approval?.saleId === context.saleId
  && approval?.attemptId === context.attemptId
  && approval?.actorKey === (context.actorContext?.actorKey || null)
  && approval?.tenant === (context.actorContext?.tenant?.opaqueId || null)
  && approval?.exactSnapshot === snapshotOf(context)
  && approval.maxMissing && typeof approval.maxMissing === 'object'
);
