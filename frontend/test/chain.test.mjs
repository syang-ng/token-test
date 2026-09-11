import assert from 'node:assert/strict';
import test from 'node:test';
import { CONFIG, SELECTORS, addressWord, errorMessage, formatUnits, readSnapshot, submitClaim, waitForReceipt } from '../dist/chain.mjs';

const account = '0x1111111111111111111111111111111111111111';
const hash = `0x${'a'.repeat(64)}`;
const word = (value) => `0x${BigInt(value).toString(16).padStart(64, '0')}`;
const textWord = (value) => {
  const hex = Buffer.from(value, 'utf8').toString('hex');
  return word(32) + word(hex.length / 2).slice(2) + hex.padEnd(Math.ceil(hex.length / 64) * 64, '0');
};

function wallet({ chain = CONFIG.chainId, claimed = false, selected = account, target = CONFIG.trader, name = CONFIG.name, failure } = {}) {
  const calls = [];
  const provider = {
    calls,
    async request(request) {
      calls.push(request);
      if (request.method === 'eth_chainId') return chain;
      if (request.method === 'eth_accounts') return [selected];
      if (request.method === 'eth_estimateGas') return '0x30000';
      if (request.method === 'eth_sendTransaction') {
        if (failure) throw failure;
        return hash;
      }
      if (request.method === 'eth_getTransactionReceipt') return { transactionHash: hash, status: '0x1', to: CONFIG.token };
      if (request.method === 'eth_call') {
        const data = request.params[0].data.slice(0, 10);
        if (data === SELECTORS.name) return textWord(name);
        if (data === SELECTORS.symbol) return textWord(CONFIG.symbol);
        return word({
          [SELECTORS.target]: target,
          [SELECTORS.token0]: CONFIG.usdc,
          [SELECTORS.token1]: CONFIG.eurc,
          [SELECTORS.decimals]: 18,
          [SELECTORS.airdrop]: 100n * 10n ** 18n,
          [SELECTORS.cap]: 1000000,
          [SELECTORS.claimed]: claimed ? 1 : 0,
          [SELECTORS.balance]: 0,
        }[data]);
      }
      throw new Error(`Unexpected method ${request.method}`);
    },
  };
  return provider;
}

test('reads and validates the deployed configuration and claim status', async () => {
  const snapshot = await readSnapshot(wallet(), account);
  assert.equal(snapshot.claimed, false);
  assert.equal(snapshot.airdrop, 100n * 10n ** 18n);
  assert.equal(snapshot.traderUsdc, 0n);
});

test('sends exactly one zero-value claim to the fixed Sepolia token', async () => {
  const provider = wallet();
  assert.equal(await submitClaim(provider, account), hash);
  const sends = provider.calls.filter((call) => call.method === 'eth_sendTransaction');
  assert.deepEqual(sends, [{ method: 'eth_sendTransaction', params: [{ from: account, to: CONFIG.token, data: SELECTORS.claim, value: '0x0', chainId: CONFIG.chainId }] }]);
  assert.ok(provider.calls.some((call) => call.method === 'eth_estimateGas'));
});

for (const [name, options, error] of [
  ['wrong network', { chain: '0x1' }, 'CHAIN'],
  ['already claimed', { claimed: true }, 'CLAIMED'],
  ['changed wallet', { selected: CONFIG.trader }, 'ACCOUNT'],
  ['unexpected target contract', { target: CONFIG.usdc }, 'CONFIG'],
  ['different token identity', { name: 'Previous Token' }, 'CONFIG'],
]) {
  test(`never requests a transaction for ${name}`, async () => {
    const provider = wallet(options);
    await assert.rejects(submitClaim(provider, account), { code: error });
    assert.equal(provider.calls.some((call) => call.method === 'eth_sendTransaction'), false);
  });
}

test('wallet rejection propagates without a second send attempt', async () => {
  const error = { code: 4001 };
  const provider = wallet({ failure: error });
  await assert.rejects(submitClaim(provider, account), (value) => value === error);
  assert.match(errorMessage(error), /cancelled/);
  assert.equal(provider.calls.filter((call) => call.method === 'eth_sendTransaction').length, 1);
});

test('requires a matching successful transaction receipt', async () => {
  assert.equal((await waitForReceipt(wallet(), hash)).status, '0x1');
  const provider = wallet();
  const original = provider.request;
  provider.request = (request) => request.method === 'eth_getTransactionReceipt'
    ? Promise.resolve({ status: '0x0', transactionHash: hash, to: CONFIG.token }) : original(request);
  await assert.rejects(waitForReceipt(provider, hash), { code: 'REVERTED' });
});

test('pending receipt times out without claiming success', async () => {
  const provider = wallet();
  const original = provider.request;
  provider.request = (request) => request.method === 'eth_getTransactionReceipt' ? Promise.resolve(null) : original(request);
  await assert.rejects(waitForReceipt(provider, hash, { timeout: 1, interval: 1 }), { code: 'PENDING' });
});

test('formats integer token units without floating point conversion', () => {
  assert.equal(formatUnits(100n * 10n ** 18n), '100');
  assert.equal(formatUnits(1500001n, 6, 6), '1.500001');
  assert.equal(addressWord(account).length, 64);
  assert.throws(() => addressWord('invalid'));
});
