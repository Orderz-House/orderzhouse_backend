/**
 * Stripe Amount Conversion Utilities (JOD only)
 * JOD uses 3 decimal places (1000 minor units)
 */

/**
 * Convert JOD amount to Stripe minor units
 * @param {number} amountJOD - Amount in JOD (e.g., 1.500)
 * @returns {number} Amount in Stripe minor units (e.g., 1500)
 */
export function toStripeAmount(amountJOD) {
  if (typeof amountJOD !== 'number' || !isFinite(amountJOD)) {
    throw new Error('Invalid amount: must be a finite number');
  }
  if (amountJOD < 0) {
    throw new Error('Amount cannot be negative');
  }
  return Math.round(amountJOD * 1000);
}

/**
 * Convert Stripe minor units to JOD amount
 * @param {number} amountMinor - Amount in Stripe minor units (e.g., 1500)
 * @returns {number} Amount in JOD (e.g., 1.500)
 */
export function fromStripeAmount(amountMinor) {
  if (typeof amountMinor !== 'number' || !isFinite(amountMinor)) {
    throw new Error('Invalid amount: must be a finite number');
  }
  return amountMinor / 1000;
}
