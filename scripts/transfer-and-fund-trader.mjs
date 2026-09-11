import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { createCipheriv, createECDH, randomBytes, randomUUID, scryptSync } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chainId, usdc, eurc, normalizePrivateKey } from './deploy.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const recordPath = resolve(root, 'deployments/sepolia-transfer-and-fund.json');
const broadcastPath = resolve(root, `broadcast/TransferAndFundTrader.s.sol/${chainId}/run-latest.json`);
const mode = process.argv[2] ?? 'simulate';
const lower = (value) => String(value).toLowerCase();
const validAddress = (value) => /^0x[0-9a-f]{40}$/i.test(value) && !/^0x0{40}$/i.test(value);

function run(binary, args, interactive = false) {
  const result = spawnSync(binary, args, {
    cwd: root, env: process.env, encoding: 'utf8',
    stdio: interactive ? 'inherit' : 'pipe', timeout: interactive ? undefined : 60000,
  });
  if (result.error || result.status !== 0) {
    throw new Error(`${binary} failed. Check RPC/account configuration. Keep records for resume; do not start a fresh broadcast.`);
  }
  return result.stdout?.trim();
}

function equal(actual, expected, label) {
  if (lower(actual) !== lower(expected)) throw new Error(`${label} mismatch.`);
}

function call(target, signature) {
  return run('cast', ['call', target, signature, '--rpc-url', 'sepolia']);
}

function castJson(args) {
  const result = JSON.parse(run('cast', [...args, '--json', '--rpc-url', 'sepolia']));
  if (result.schema_version !== undefined) {
    if (!result.success || !result.data) throw new Error('Cast returned an unsuccessful response.');
    return result.data;
  }
  return result;
}

function save(record) {
  mkdirSync(dirname(recordPath), { recursive: true });
  writeFileSync(`${recordPath}.tmp`, `${JSON.stringify(record, null, 2)}\n`);
  renameSync(`${recordPath}.tmp`, recordPath);
}

function keccak(bytes) {
  const result = spawnSync('cast', ['keccak'], {
    encoding: 'utf8', input: `0x${bytes.toString('hex')}`, timeout: 10000,
  });
  if (result.status !== 0 || !/^0x[0-9a-f]{64}$/i.test(result.stdout.trim())) throw new Error('Keccak hashing failed.');
  return result.stdout.trim().slice(2);
}

function resumeWithWallets(args, record) {
  // --resume skips run(), so explicitly provide both signers. Temporary V3
  // keystores keep raw keys out of argv and are deleted even if Forge fails.
  const directory = mkdtempSync(resolve(tmpdir(), 'trader-funding-wallets-'));
  try {
    const password = randomBytes(32).toString('hex');
    const passwordFile = resolve(directory, 'password');
    writeFileSync(passwordFile, password, { mode: 0o600 });
    for (const [name, expected] of [['DEPLOYER_PRIVATE_KEY', record.oldOwner], ['NEW_OWNER_PRIVATE_KEY', record.newOwner]]) {
      const key = Buffer.from(process.env[name].slice(2), 'hex');
      const ecdh = createECDH('secp256k1');
      ecdh.setPrivateKey(key);
      const address = keccak(ecdh.getPublicKey().subarray(1)).slice(-40);
      equal(`0x${address}`, expected, `${name} signer`);
      const salt = randomBytes(32), iv = randomBytes(16);
      const derived = scryptSync(password, salt, 32, { N: 16384, r: 8, p: 1 });
      const cipher = createCipheriv('aes-128-ctr', derived.subarray(0, 16), iv);
      const ciphertext = Buffer.concat([cipher.update(key), cipher.final()]);
      const file = resolve(directory, name);
      writeFileSync(file, JSON.stringify({
        version: 3, id: randomUUID(), address,
        crypto: {
          cipher: 'aes-128-ctr', cipherparams: { iv: iv.toString('hex') }, ciphertext: ciphertext.toString('hex'),
          kdf: 'scrypt', kdfparams: { dklen: 32, n: 16384, r: 8, p: 1, salt: salt.toString('hex') },
          mac: keccak(Buffer.concat([derived.subarray(16, 32), ciphertext])),
        },
      }), { mode: 0o600 });
      args.push('--keystores', file, '--password-file', passwordFile);
    }
    run('forge', args, true);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

try {
  if (!['simulate', 'run', 'resume', 'verify'].includes(mode)) throw new Error('Use simulate, run, resume, or verify.');
  if (existsSync(resolve(root, '.env'))) process.loadEnvFile(resolve(root, '.env'));
  if (!process.env.SEPOLIA_RPC_URL) throw new Error('Set SEPOLIA_RPC_URL in .env.');
  equal(run('cast', ['chain-id', '--rpc-url', 'sepolia']), chainId, 'RPC network');

  let record;
  if (mode === 'resume' || mode === 'verify') {
    if (!existsSync(recordPath) || !existsSync(broadcastPath)) throw new Error('Both operation and broadcast records are required.');
    record = JSON.parse(readFileSync(recordPath, 'utf8'));
    equal(record.chainId, chainId, 'Recorded network');
    if (mode === 'resume' && record.status === 'complete') throw new Error('Already completed. Use verify.');
    for (const [name, value] of [['TRADER_ADDRESS', record.trader], ['NEW_OWNER_ADDRESS', record.newOwner]]) {
      if (process.env[name]) equal(process.env[name], value, name);
      process.env[name] = value;
    }
  } else {
    let trader = process.env.TRADER_ADDRESS;
    if (!trader) {
      const deployment = JSON.parse(readFileSync(resolve(root, 'deployments/sepolia.json'), 'utf8'));
      equal(deployment.chainId, chainId, 'Deployment network');
      trader = deployment.contracts.VulnerableTrader.address;
    }
    record = { chainId, trader, newOwner: process.env.NEW_OWNER_ADDRESS, status: 'prepared' };
    process.env.TRADER_ADDRESS = trader;
  }
  if (!validAddress(record.trader) || !validAddress(record.newOwner)) throw new Error('Set valid TRADER_ADDRESS and NEW_OWNER_ADDRESS.');
  equal(call(record.trader, 'token0()(address)'), usdc, 'Trader USDC');
  equal(call(record.trader, 'token1()(address)'), eurc, 'Trader EURC');

  if (mode !== 'verify') {
    for (const name of ['DEPLOYER_PRIVATE_KEY', 'NEW_OWNER_PRIVATE_KEY']) {
      if (!process.env[name]) throw new Error(`Set ${name} in local .env. This script requires both signing keys.`);
      try { process.env[name] = normalizePrivateKey(process.env[name]); }
      catch { throw new Error(`${name} must be a valid signing key.`); }
    }
    const args = ['script', 'script/TransferAndFundTrader.s.sol:TransferAndFundTrader', '--rpc-url', 'sepolia', '--disable-external-identification'];
    if (mode === 'run') {
      if (existsSync(recordPath) || existsSync(broadcastPath)) throw new Error('Operation records already exist. Use resume or verify to avoid duplicate transfers.');
      // Simulate all three transactions successfully before creating an operation record or broadcasting.
      run('forge', args, true);
      record.oldOwner = call(record.trader, 'owner()(address)');
      save(record);
    }
    if (mode !== 'simulate') args.push('--broadcast', '--slow');
    if (mode === 'resume') args.push('--resume');
    if (mode === 'resume') resumeWithWallets(args, record);
    else run('forge', args, true);
  }

  if (mode === 'simulate') {
    console.log('Simulation passed: transfer ownership, then send 1 USDC + 1 EURC from the new owner. No transactions broadcast.');
  } else {
    const broadcast = JSON.parse(readFileSync(broadcastPath, 'utf8'));
    equal(broadcast.chain, chainId, 'Broadcast network');
    if (broadcast.pending?.length || broadcast.transactions?.length !== 3) throw new Error('Expected three completed transactions. Use resume.');
    const ownershipData = run('cast', ['calldata', 'transferOwner(address)', record.newOwner]);
    const transferData = run('cast', ['calldata', 'transfer(address,uint256)', record.trader, '1000000']);
    const expected = [
      [record.trader, record.oldOwner, ownershipData],
      [usdc, record.newOwner, transferData],
      [eurc, record.newOwner, transferData],
    ];
    record.transactions = broadcast.transactions.map((tx, index) => {
      const receipt = castJson(['receipt', tx.hash]);
      const transaction = castJson(['tx', tx.hash]);
      const [to, from, data] = expected[index];
      equal(receipt.transactionHash, tx.hash, 'Receipt hash');
      if (Number(receipt.status) !== 1) throw new Error('Transaction reverted. Inspect broadcast records before retrying.');
      equal(transaction.to, to, 'Transaction destination');
      equal(transaction.from, from, 'Transaction signer');
      equal(transaction.input, data, 'Transaction calldata');
      if (BigInt(transaction.value) !== 0n) throw new Error('Unexpected ETH transfer.');
      return { hash: tx.hash, from, to, blockNumber: Number(receipt.blockNumber) };
    });
    equal(call(record.trader, 'owner()(address)'), record.newOwner, 'Final Trader owner');
    record.status = 'complete';
    save(record);
    console.log(`Verified: Trader owner is ${record.newOwner}; new owner sent 1 USDC and 1 EURC to ${record.trader}.`);
    for (const tx of record.transactions) console.log(`https://sepolia.etherscan.io/tx/${tx.hash}`);
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
