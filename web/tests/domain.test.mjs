import test from 'node:test';
import assert from 'node:assert/strict';
import {
  amountInput,
  openingInput,
  phase,
  refund,
  releaseReady,
  GRACE,
} from '../src/domain.mjs';

test('release requires strictly over 50% and an inclusive three-day boundary', () => {
  const raise = {
    deadline: 1000n,
    voteOpenedAt: 1000n,
    released: 0,
    totalShares: 100n,
    approvalWeight: 50n,
    unreleased: 101n,
  };
  assert.equal(releaseReady(raise, 1000n + GRACE), false);
  raise.approvalWeight = 51n;
  assert.equal(releaseReady(raise, 1000n + GRACE - 1n), false);
  assert.equal(releaseReady(raise, 1000n + GRACE), true);
  assert.equal(phase(raise, 999n), 'Funding');
  assert.equal(phase(raise, 1000n), 'Grace period');
  raise.released = 3;
  assert.equal(releaseReady(raise, 1000n + GRACE), false);
});
test('refund estimate preserves full funding shares and last-backer remainder', () => {
  const raise = { deadline: 100n, unreleased: 101n, totalShares: 9n };
  assert.equal(refund(raise, 2n, 99n), 2n);
  assert.equal(refund(raise, 2n, 100n), 22n);
  assert.equal(refund(raise, 9n, 100n), 101n);
  assert.equal(refund({ ...raise, totalShares: 0n }, 0n, 100n), 0n);
});
test('amounts reject rounding, exponents, negative, zero, and uint256 overflow', () => {
  assert.equal(amountInput('1.000000000000000001', 18), 1000000000000000001n);
  for (const value of [
    '1.0000000000000000001',
    '1e3',
    '-1',
    '0',
    '.5',
    '1,000',
    String(2n ** 256n),
  ])
    assert.throws(() => amountInput(value, 18));
});
test('raise split and funding duration enforce contract boundaries', () => {
  assert.deepEqual(openingInput(['0.01', '0.01', '99.98'], '1'), [
    1,
    1,
    9998,
    86400n,
  ]);
  assert.deepEqual(openingInput(['30', '30', '40'], '90'), [
    3000,
    3000,
    4000,
    7776000n,
  ]);
  for (const args of [
    [['30', '30', '30'], '14'],
    [['0', '30', '70'], '14'],
    [['30.001', '30', '39.999'], '14'],
    [['30', '30', '40'], '0'],
    [['30', '30', '40'], '91'],
    [['30', '30', '40'], '1.5'],
  ])
    assert.throws(() => openingInput(...args));
});
