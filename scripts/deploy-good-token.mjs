import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chainId, usdc, eurc, normalizePrivateKey } from './deploy.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const recordPath = resolve(root, 'deployments/sepolia-good-token.json');
const broadcastPath = resolve(root, `broadcast/DeployGoodToken.s.sol/${chainId}/run-latest.json`);
const mode = process.argv[2] ?? 'simulate';

function run(binary, args, interactive = false) {
  const result = spawnSync(binary, args, { cwd: root, env: process.env, encoding: 'utf8', stdio: interactive ? 'inherit' : 'pipe', timeout: interactive ? undefined : 60000 });
  if (result.error || result.status !== 0) throw new Error(`${binary} failed. Check the RPC or wallet configuration.`);
  return result.stdout?.trim();
}

function call(address, signature) {
  return run('cast', ['call', address, signature, '--rpc-url', 'sepolia']).replace(/^"|"$/g, '');
}

function equal(actual, expected, label) {
  if (String(actual).toLowerCase() !== String(expected).toLowerCase()) throw new Error(`${label} verification failed.`);
}

try {
  if (!['simulate', 'deploy', 'verify'].includes(mode)) throw new Error('Use simulate, deploy, or verify.');
  if (existsSync(resolve(root, '.env'))) process.loadEnvFile(resolve(root, '.env'));
  const original = JSON.parse(readFileSync(resolve(root, 'deployments/sepolia.json'), 'utf8'));
  equal(original.chainId, chainId, 'Source deployment network');
  const trader = original.contracts.VulnerableTrader.address;
  process.env.TRADER_ADDRESS = trader;
  if (process.env.DEPLOYER_PRIVATE_KEY) process.env.DEPLOYER_PRIVATE_KEY = normalizePrivateKey(process.env.DEPLOYER_PRIVATE_KEY);
  equal(run('cast', ['chain-id', '--rpc-url', 'sepolia']), chainId, 'RPC network');
  equal(call(trader, 'token0()(address)'), usdc, 'Trader USDC');
  equal(call(trader, 'token1()(address)'), eurc, 'Trader EURC');

  if (mode === 'deploy' && (existsSync(recordPath) || existsSync(broadcastPath))) {
    throw new Error('Good Token already has a broadcast record. Use verify to check the existing deployment.');
  }
  if (mode !== 'verify') {
    const args = ['script', 'script/DeployGoodToken.s.sol:DeployGoodToken', '--rpc-url', 'sepolia'];
    if (!process.env.DEPLOYER_PRIVATE_KEY) {
      if (!process.env.DEPLOYER_ADDRESS) throw new Error('Set DEPLOYER_PRIVATE_KEY or DEPLOYER_ADDRESS.');
      args.push('--sender', process.env.DEPLOYER_ADDRESS);
      if (mode === 'deploy') {
        if (!process.env.FOUNDRY_ACCOUNT) throw new Error('Set FOUNDRY_ACCOUNT for keystore signing.');
        args.push('--account', process.env.FOUNDRY_ACCOUNT);
        if (process.env.KEYSTORE_PASSWORD_FILE) args.push('--password-file', process.env.KEYSTORE_PASSWORD_FILE);
      }
    }
    if (mode === 'deploy') args.push('--broadcast', '--slow');
    run('forge', args, true);
  }

  if (mode === 'simulate') {
    console.log('Good Token simulation passed. No transaction was broadcast.');
  } else {
    const broadcast = JSON.parse(readFileSync(broadcastPath, 'utf8'));
    equal(broadcast.chain, chainId, 'Broadcast network');
    if (broadcast.pending?.length || broadcast.transactions?.length !== 1) throw new Error('Expected one completed deployment transaction.');
    const transaction = broadcast.transactions[0];
    if (transaction.transactionType !== 'CREATE' || transaction.contractName !== 'MaliciousAirdropToken') throw new Error('Unexpected deployment transaction.');
    const receipt = JSON.parse(run('cast', ['receipt', transaction.hash, '--json', '--rpc-url', 'sepolia']));
    if (Number(receipt.status) !== 1) throw new Error('Deployment was not successful.');
    equal(receipt.transactionHash, transaction.hash, 'Receipt hash');
    equal(receipt.contractAddress, transaction.contractAddress, 'Receipt address');
    const address = receipt.contractAddress;
    const owner = transaction.transaction.from;
    equal(owner, original.owner, 'Deployment owner');
    equal(call(address, 'name()(string)'), 'Good Token', 'Token name');
    equal(call(address, 'symbol()(string)'), 'GTK', 'Token symbol');
    equal(call(address, 'owner()(address)'), owner, 'Token owner');
    equal(call(address, 'targetTrader()(address)'), trader, 'Target Trader');
    equal(call(address, 'TOKEN0()(address)'), usdc, 'Token USDC');
    equal(call(address, 'TOKEN1()(address)'), eurc, 'Token EURC');
    equal(call(address, 'decimals()(uint8)').split(/\s/)[0], 18, 'Decimals');
    equal(call(address, 'airdropAmount()(uint256)').split(/\s/)[0], '100000000000000000000', 'Airdrop amount');
    const record = {
      network: 'ethereum-sepolia', chainId, name: 'Good Token', symbol: 'GTK', address, owner,
      targetTrader: trader, usdc, eurc, decimals: 18, airdropAmount: '100000000000000000000',
      transactionHash: receipt.transactionHash, blockNumber: Number(receipt.blockNumber),
      explorer: `https://sepolia.etherscan.io/address/${address}`,
    };
    writeFileSync(`${recordPath}.tmp`, `${JSON.stringify(record, null, 2)}\n`);
    renameSync(`${recordPath}.tmp`, recordPath);
    console.log(`Verified Good Token deployment saved to ${recordPath}`);
    console.log(record.explorer);
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
