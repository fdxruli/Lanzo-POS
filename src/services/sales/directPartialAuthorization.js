// A checkout confirmation is scoped to one captured cart, actor and attempt.
// This is a client acknowledgement, not a bypass of inventory/RLS checks.
export const getDirectPartialRecipeSnapshot = (product) => ({
  productId: product?.id || null,
  recipe: Array.isArray(product?.recipe) ? product.recipe : [],
  conversionFactor: product?.conversionFactor || null
});

const snapshotOf = ({ order, total, paymentData, saleId, attemptId, actorContext, recipeSnapshot }) => JSON.stringify({
  order, total: String(total), saleId, attemptId,
  actorKey: actorContext?.actorKey || null,
  tenant: actorContext?.tenant?.opaqueId || null,
  recipeSnapshot: recipeSnapshot || {},
  payment: {
    paymentMethod: paymentData?.paymentMethod,
    payments: paymentData?.payments || null,
    paymentBreakdown: paymentData?.paymentBreakdown || null,
    paymentDetails: paymentData?.paymentDetails || null,
    initialPaymentMethod: paymentData?.initialPaymentMethod || null,
    abonoPaymentMethod: paymentData?.abonoPaymentMethod || null,
    creditPaymentMethod: paymentData?.creditPaymentMethod || null,
    partialPaymentMethod: paymentData?.partialPaymentMethod || null,
    amountPaid: paymentData?.amountPaid,
    saldoPendiente: paymentData?.saldoPendiente,
    customerId: paymentData?.customerId,
    dueDate: paymentData?.dueDate || null,
    cashSessionId: paymentData?.cashSessionId || paymentData?.cash_session_id || null,
    cashStationId: paymentData?.cashStationId || paymentData?.cash_station_id || null,
    localStationKey: paymentData?.localStationKey || paymentData?.local_station_key || null,
    saleDiscount: paymentData?.saleDiscount || paymentData?.discount || null
  }
});
export const captureDirectPartialAuthorization = (context, shortages) => ({
  version: 1,
  saleId: context.saleId,
  attemptId: context.attemptId,
  actorKey: context.actorContext?.actorKey || null,
  tenant: context.actorContext?.tenant?.opaqueId || null,
  exactSnapshot: snapshotOf(context),
  recipeSnapshot: JSON.parse(JSON.stringify(context.recipeSnapshot || {})),
  approvedItems: (context.order || []).map((item) => ({
    productId: item.productId || item.parentId || item.id,
    quantity: item.quantity,
    selectedModifiers: item.selectedModifiers || []
  })),
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
