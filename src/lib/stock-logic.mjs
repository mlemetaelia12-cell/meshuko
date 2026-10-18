/** Convert a form/database quantity into a number for previews only. */
export function quantityNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Whole animal counts must always be safe, non-negative integers. */
export function isValidQuantity(value) {
  if (typeof value === 'string' && value.trim() === '') return false;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0;
}

/** Calculate a group's expected closing quantity from a daily report line. */
export function calculateClosingStock(line) {
  return quantityNumber(line.opening_quantity)
    + quantityNumber(line.born_quantity)
    + quantityNumber(line.new_stock_quantity)
    + quantityNumber(line.transfer_in_quantity)
    - quantityNumber(line.transfer_out_quantity)
    - quantityNumber(line.lost_quantity)
    - quantityNumber(line.mortality_quantity)
    - quantityNumber(line.sold_quantity)
    - quantityNumber(line.slaughter_quantity);
}
