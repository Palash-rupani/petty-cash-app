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

/**
 * Compact currency display for KPI cards and dashboard stat cards.
 * Abbreviates large amounts using Indian short-form notation.
 *
 *   >= 1 Crore  (1,00,00,000)  →  ₹X.XCr
 *   >= 1 Lakh   (1,00,000)     →  ₹X.XL
 *   otherwise                  →  formatCurrency() (full Indian formatting)
 *
 * Use ONLY for dashboard KPI headline values, NOT for table cells,
 * line-item amounts, or any place where precision matters.
 */
export function compactCurrency(amount: number): string {
  if (amount >= 10_000_000) {
    return `₹${(amount / 10_000_000).toFixed(1)}Cr`
  }
  if (amount >= 100_000) {
    return `₹${(amount / 100_000).toFixed(1)}L`
  }
  return formatCurrency(amount)
}
