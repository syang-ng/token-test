import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const chainId = 11155111;
export const usdc = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238';
export const eurc = '0x08210F9170F89Ab7658F0B5E3fF39b0E03C594D4';
const lower = (value) => String(value).toLowerCase();
const address = (value) => /^0x[0-9a-f]{40}$/i.test(value) && !/^0x0{40}$/i.test(value);

export function normalizePrivateKey(value) {
  const key = value.startsWith('0x') ? value : `0x${value}`;
  const curveOrder = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
  if (!/^0x[0-9a-f]{64}$/i.test(key) || BigInt(key) === 0n || BigInt(key) >= curveOrder) {
    throw new Error('DEPLOYER_PRIVATE_KEY must be a valid 32-byte hex signing key.');
  }
  return key;
}

// Only confirmed CREATE receipts may produce a deployment manifest.
export function summarizeDeployment(run) {
  if (Number(run.chain) !== chainId) throw new Error('Broadcast record is not Ethereum Sepolia.');
  if (run.pending?.length) throw new Error('Deployment still has pending transactions. Use make resume.');
  const names = ['VulnerableTrader', 'MaliciousAirdropToken'];
  const contracts = {};
  let owner;
  if (run.transactions?.length !== 2) throw new Error('Expected exactly two deployment transactions.');
  for (const [index, name] of names.entries()) {
    const tx = run.transactions[index];
    if (tx.transactionType !== 'CREATE' || tx.contractName !== name || !address(tx.contractAddress)) {
      throw new Error(`Missing or invalid ${name} deployment.`);
    }
    const receipt = run.receipts?.find((item) => lower(item.transactionHash) === lower(tx.hash));
    if (!receipt || Number(receipt.status) !== 1 || lower(receipt.contractAddress) !== lower(tx.contractAddress)) {
      throw new Error(`${name} has no successful matching deployment receipt.`);
    }
    if (!address(tx.transaction?.from)) throw new Error('Missing deployment sender.');
    owner ??= tx.transaction.from;
    if (lower(owner) !== lower(tx.transaction.from)) throw new Error('Deployment owners differ.');
    contracts[name] = {
      address: tx.contractAddress,
      transactionHash: receipt.transactionHash,
      blockNumber: Number(receipt.blockNumber),
      explorer: `https://sepolia.etherscan.io/address/${tx.contractAddress}`,
    };
  }
  return { network: 'ethereum-sepolia', chainId, owner, usdc, eurc, contracts };
}

function command(binary, args, interactive = false) {
  const result = spawnSync(binary, args, {
    cwd: root,
    env: process.env,
    stdio: interactive ? 'inherit' : 'pipe',
    encoding: 'utf8',
    timeout: interactive ? undefined : 60000,
  });
  if (result.error || result.status !== 0) {
    // RPC URLs may contain credentials; do not repeat child arguments or error output.
    throw new Error(`${binary} failed${result.error?.code ? ` (${result.error.code})` : ''}. Check RPC access and configuration.`);
  }
  return result.stdout?.trim();
}

function call(target, signature) {
  return command('cast', ['call', target, signature, '--rpc-url', 'sepolia']);
}

function checkAddress(actual, expected, field) {
  if (lower(actual) !== lower(expected)) throw new Error(`On-chain ${field} does not match deployment configuration.`);
}

export function main(mode = 'simulate') {
  if (!['simulate', 'deploy', 'resume'].includes(mode)) throw new Error('Usage: node scripts/deploy.mjs [simulate|deploy|resume]');
  if (existsSync(resolve(root, '.env'))) process.loadEnvFile(resolve(root, '.env'));
  const env = process.env;
  if (!env.SEPOLIA_RPC_URL) throw new Error('Set SEPOLIA_RPC_URL in .env.');
  if (env.DEPLOYER_PRIVATE_KEY) {
    env.DEPLOYER_PRIVATE_KEY = normalizePrivateKey(env.DEPLOYER_PRIVATE_KEY);
  } else if (!address(env.DEPLOYER_ADDRESS)) {
    throw new Error('Set DEPLOYER_PRIVATE_KEY, or the keystore public DEPLOYER_ADDRESS, in .env.');
  }

  if (Number(command('cast', ['chain-id', '--rpc-url', 'sepolia'])) !== chainId) {
    throw new Error('RPC must point to Ethereum Sepolia (11155111).');
  }
  const output = resolve(root, 'deployments/sepolia.json');
  const broadcast = resolve(root, `broadcast/Deploy.s.sol/${chainId}/run-latest.json`);
  if (mode === 'deploy' && (existsSync(output) || existsSync(broadcast))) {
    throw new Error('A broadcast record already exists. Use make resume; archive existing records before a fresh deployment.');
  }
  if (mode === 'resume' && !existsSync(broadcast)) throw new Error('No deployment broadcast record to resume.');

  const args = ['script', 'script/Deploy.s.sol:Deploy', '--rpc-url', 'sepolia'];
  if (!env.DEPLOYER_PRIVATE_KEY) {
    args.push('--sender', env.DEPLOYER_ADDRESS);
    if (mode !== 'simulate') {
      if (!env.FOUNDRY_ACCOUNT) throw new Error('Set FOUNDRY_ACCOUNT for keystore signing.');
      args.push('--account', env.FOUNDRY_ACCOUNT);
      if (env.KEYSTORE_PASSWORD_FILE) args.push('--password-file', env.KEYSTORE_PASSWORD_FILE);
    }
  }
  if (mode !== 'simulate') args.push('--broadcast', '--slow');
  if (mode === 'resume') args.push('--resume');
  command('forge', args, true);
  if (mode === 'simulate') {
    console.log('Simulation passed. No transactions were broadcast. Run make deploy to deploy.');
    return;
  }

  const run = JSON.parse(readFileSync(broadcast, 'utf8'));
  summarizeDeployment(run);
  // Refresh receipts from the selected RPC, then verify the deployed configuration.
  run.receipts = run.transactions.map((tx) => JSON.parse(command('cast', ['receipt', tx.hash, '--json', '--rpc-url', 'sepolia'])));
  const summary = summarizeDeployment(run);
  const trader = summary.contracts.VulnerableTrader.address;
  const token = summary.contracts.MaliciousAirdropToken.address;
  if (env.DEPLOYER_ADDRESS) checkAddress(summary.owner, env.DEPLOYER_ADDRESS, 'sender');
  checkAddress(call(trader, 'token0()(address)'), usdc, 'trader.token0');
  checkAddress(call(trader, 'token1()(address)'), eurc, 'trader.token1');
  checkAddress(call(trader, 'owner()(address)'), summary.owner, 'trader.owner');
  checkAddress(call(token, 'owner()(address)'), summary.owner, 'token.owner');
  checkAddress(call(token, 'targetTrader()(address)'), trader, 'token.targetTrader');
  checkAddress(call(token, 'TOKEN0()(address)'), usdc, 'token.TOKEN0');
  checkAddress(call(token, 'TOKEN1()(address)'), eurc, 'token.TOKEN1');
  summary.maxCallbackPayment = call(trader, 'maxCallbackPayment()(uint256)').split(/\s/)[0];
  summary.airdropAmount = call(token, 'airdropAmount()(uint256)').split(/\s/)[0];
  summary.tokenDecimals = Number(call(token, 'decimals()(uint8)').split(/\s/)[0]);
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(`${output}.tmp`, `${JSON.stringify(summary, null, 2)}\n`);
  renameSync(`${output}.tmp`, output);
  console.log(`Verified deployment saved to ${output}`);
  console.log(`Trader: ${summary.contracts.VulnerableTrader.explorer}`);
  console.log(`Token:  ${summary.contracts.MaliciousAirdropToken.explorer}`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    main(process.argv[2]);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
