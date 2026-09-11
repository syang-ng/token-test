import assert from 'node:assert/strict';
import test from 'node:test';
import { summarizeDeployment, normalizePrivateKey, chainId } from './deploy.mjs';

test('accepts signing keys with or without a hex prefix without changing the key', () => {
  const key = '1'.repeat(64);
  assert.equal(normalizePrivateKey(key), `0x${key}`);
  assert.equal(normalizePrivateKey(`0x${key}`), `0x${key}`);
  assert.throws(() => normalizePrivateKey('0'.repeat(64)));
  assert.throws(() => normalizePrivateKey('f'.repeat(64)));
  assert.throws(() => normalizePrivateKey('invalid'));
});

function fixture() {
  const owner = `0x${'a'.repeat(40)}`;
  const transactions = ['VulnerableTrader', 'MaliciousAirdropToken'].map((contractName, i) => ({
    contractName,
    transactionType: 'CREATE',
    contractAddress: `0x${String(i + 1).repeat(40)}`,
    hash: `0x${String(i + 1).repeat(64)}`,
    transaction: { from: owner },
  }));
  return {
    chain: chainId,
    transactions,
    pending: [],
    receipts: transactions.map((tx) => ({
      transactionHash: tx.hash,
      contractAddress: tx.contractAddress,
      status: '0x1',
      blockNumber: '0x42',
    })),
  };
}

test('exports only public metadata from two confirmed deployments', () => {
  const run = fixture();
  run.rpc = 'https://provider.example/secret';
  const summary = summarizeDeployment(run);
  assert.equal(summary.contracts.MaliciousAirdropToken.blockNumber, 66);
  assert.equal(summary.contracts.VulnerableTrader.transactionHash, run.transactions[0].hash);
  assert.equal(JSON.stringify(summary).includes('secret'), false);
});

for (const [name, mutate] of [
  ['wrong chain', (run) => { run.chain = 1; }],
  ['pending transaction', (run) => { run.pending = ['0x123']; }],
  ['dry run without receipts', (run) => { run.receipts = []; }],
  ['failed transaction', (run) => { run.receipts[1].status = '0x0'; }],
  ['wrong receipt address', (run) => { run.receipts[1].contractAddress = run.transactions[0].contractAddress; }],
  ['different senders', (run) => { run.transactions[1].transaction.from = `0x${'b'.repeat(40)}`; }],
  ['partial deployment', (run) => { run.transactions.pop(); }],
]) {
  test(`rejects ${name}`, () => {
    const run = fixture();
    mutate(run);
    assert.throws(() => summarizeDeployment(run));
  });
}
