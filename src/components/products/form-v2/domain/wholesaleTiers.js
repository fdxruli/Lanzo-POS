export const normalizeWholesaleTiers = (wholesaleTiers = []) => (
  wholesaleTiers.map((tier) => ({
    ...tier,
    min: Number.parseFloat(tier.min),
    price: Number.parseFloat(tier.price)
  }))
);
