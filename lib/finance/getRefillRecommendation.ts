/**
 * Returns the recommended cash top-up amount needed to bring a store's
 * balance back to its target float.
 *
 * Formula: Math.max(targetFloat - currentBalance, 0)
 *
 * Returns 0 when the balance already meets or exceeds the target float.
 * Negative balances increase the recommended refill accordingly.
 */
export function getRefillRecommendation(balance: number, targetFloat: number): number {
  return Math.max(targetFloat - balance, 0)
}
