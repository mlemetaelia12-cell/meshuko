import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateClosingStock, isValidQuantity } from '../src/lib/stock-logic.mjs';

test('closing stock includes additions and excludes losses', () => {
  const line = { opening_quantity: 100, born_quantity: 8, new_stock_quantity: 5, transfer_in_quantity: 2, transfer_out_quantity: 3, lost_quantity: 1, mortality_quantity: 2, sold_quantity: 4, slaughter_quantity: 1 };
  assert.equal(calculateClosingStock(line), 104);
});

test('sick count is intentionally not part of the stock formula', () => {
  const line = { opening_quantity: 20, born_quantity: 0, new_stock_quantity: 0, transfer_in_quantity: 0, transfer_out_quantity: 0, lost_quantity: 0, mortality_quantity: 0, sold_quantity: 0, slaughter_quantity: 0, sick_quantity: 7 };
  assert.equal(calculateClosingStock(line), 20);
});

test('internal transfer balances out at farm total level', () => {
  const source = { opening_quantity: 20, born_quantity: 0, new_stock_quantity: 0, transfer_in_quantity: 0, transfer_out_quantity: 5, lost_quantity: 0, mortality_quantity: 0, sold_quantity: 0, slaughter_quantity: 0 };
  const destination = { opening_quantity: 10, born_quantity: 0, new_stock_quantity: 0, transfer_in_quantity: 5, transfer_out_quantity: 0, lost_quantity: 0, mortality_quantity: 0, sold_quantity: 0, slaughter_quantity: 0 };
  assert.equal(calculateClosingStock(source) + calculateClosingStock(destination), 30);
});

test('animal quantity validation rejects negatives, decimals and blanks', () => {
  assert.equal(isValidQuantity(0), true);
  assert.equal(isValidQuantity('12'), true);
  assert.equal(isValidQuantity(-1), false);
  assert.equal(isValidQuantity('2.5'), false);
  assert.equal(isValidQuantity(''), false);
});

test('closing stock can go negative in preview so validation can block finalization', () => {
  const line = { opening_quantity: 4, born_quantity: 0, new_stock_quantity: 0, transfer_in_quantity: 0, transfer_out_quantity: 0, lost_quantity: 0, mortality_quantity: 0, sold_quantity: 6, slaughter_quantity: 0 };
  assert.equal(calculateClosingStock(line), -2);
});
