import { formatUnits, parseUnits } from 'viem';
export const DAY = 86400n;
export const GRACE = 3n * DAY;
export function amountInput(value, decimals) {
  if (!/^\d+(\.\d+)?$/.test(value))
    throw Error(
      'Enter a positive token amount using digits and a decimal point.',
    );
  if ((value.split('.')[1]?.length ?? 0) > decimals)
    throw Error(`Use at most ${decimals} decimal places.`);
  const amount = parseUnits(value, decimals);
  if (amount <= 0n || amount >= 2n ** 256n)
    throw Error(
      'Enter an amount greater than zero and within the token limit.',
    );
  return amount;
}
export function openingInput(shares, days) {
  const bps = shares.map((value) => {
    if (!/^\d+(\.\d{1,2})?$/.test(value))
      throw Error('Use up to two decimals for each milestone percentage.');
    return Number(parseUnits(value, 2));
  });
  if (
    bps.some((value) => value < 1 || value > 10000) ||
    bps.reduce((a, b) => a + b, 0) !== 10000
  )
    throw Error(
      'Each milestone must be at least 0.01%; the three shares must total 100%.',
    );
  if (!/^\d+$/.test(days) || Number(days) < 1 || Number(days) > 90)
    throw Error('Choose a whole number of funding days from 1 to 90.');
  return [...bps, BigInt(days) * DAY];
}
export function phase(raise, timestamp) {
  if (timestamp < raise.deadline) return 'Funding';
  if (raise.released === 3 || raise.totalShares === 0n) return 'Closed';
  if (timestamp < raise.voteOpenedAt + GRACE) return 'Grace period';
  if (raise.approvalWeight * 2n > raise.totalShares) return 'Ready to release';
  return 'Awaiting votes';
}
export function refund(raise, shares, timestamp) {
  if (shares === 0n) return 0n;
  if (timestamp < raise.deadline) return shares;
  if (shares === raise.totalShares) return raise.unreleased;
  return (shares * raise.unreleased) / raise.totalShares;
}
export function releaseReady(raise, timestamp) {
  return (
    raise.released < 3 &&
    raise.approvalWeight * 2n > raise.totalShares &&
    timestamp >= raise.voteOpenedAt + GRACE
  );
}
export function displayAmount(amount, decimals) {
  const exact = formatUnits(amount, decimals);
  const [whole, fraction] = exact.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  if (!fraction) return grouped;
  if (amount > 0n && amount < parseUnits('0.0001', decimals)) return '<0.0001';
  return `${grouped}.${fraction.slice(0, 4).replace(/0+$/, '') || '0'}`;
}
export const shortAddress = (address) =>
  `${address.slice(0, 6)}…${address.slice(-4)}`;
