/**
 * Format a number as Indian Rupee currency
 * Uses Indian number formatting: 1,23,456 (lakhs/crores system)
 */
export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount)
}

/**
 * Format a number with Indian number formatting (no currency symbol)
 */
export function formatNumber(amount: number): string {
  return new Intl.NumberFormat('en-IN').format(amount)
}
