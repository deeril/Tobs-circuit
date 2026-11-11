const MAX_RATE_NGN = 1_000_000;

export function validatePricingRules(rules) {
  const amounts = ['baseFee', 'perKilometre', 'perMinute', 'additionalFee'];
  if (!rules || !amounts.every(key =>
    Number.isFinite(rules[key]) && rules[key] >= 0 && rules[key] <= MAX_RATE_NGN
  )) return false;
  return typeof rules.currency === 'string' && /^[A-Z]{3}$/.test(rules.currency);
}

export function estimateDeliveryPrice({ distanceKm, durationMinutes, rules }) {
  if (!validatePricingRules(rules)
    || !Number.isFinite(distanceKm) || distanceKm < 0
    || !Number.isFinite(durationMinutes) || durationMinutes < 1) {
    throw new TypeError('A valid route and configured pricing rules are required.');
  }
  const subtotal = rules.baseFee
    + distanceKm * rules.perKilometre
    + durationMinutes * rules.perMinute
    + rules.additionalFee;
  const amount = Math.round(subtotal * 100) / 100;
  if (!Number.isFinite(amount) || amount > MAX_RATE_NGN * 100) {
    throw new RangeError('The estimated delivery price is outside the supported range.');
  }
  return { amount, currency: rules.currency, ruleVersion: rules.version };
}
