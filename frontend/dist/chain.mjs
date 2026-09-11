export const CONFIG = Object.freeze({
  chainId: '0xaa36a7',
  name: 'Good Token',
  symbol: 'GTK',
  token: '0x4d0833a58e8a1c5a66fb264552976e40564d9813',
  trader: '0x971efeb78a490b6d77885ee552e883956cdb78c6',
  usdc: '0x1c7d4b196cb0c7b01d743fbc6116a902379c7238',
  eurc: '0x08210f9170f89ab7658f0b5e3ff39b0e03c594d4',
  explorer: 'https://sepolia.etherscan.io',
});

export const SELECTORS = Object.freeze({
  name: '0x06fdde03', symbol: '0x95d89b41',
  claim: '0x5b88349d', claimed: '0xc884ef83', balance: '0x70a08231',
  airdrop: '0xfc2ea8a5', decimals: '0x313ce567', target: '0x19086b4f',
  token0: '0x0dfe1681', token1: '0xd21220a7', cap: '0xc08d13a3',
});

export class DemoError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

export function addressWord(address) {
  if (!/^0x[0-9a-f]{40}$/i.test(address)) throw new DemoError('ADDRESS', 'Invalid wallet address.');
  return address.slice(2).toLowerCase().padStart(64, '0');
}

export function uint(value) {
  if (!/^0x[0-9a-f]{64}$/i.test(value)) throw new DemoError('RPC', 'Could not read onchain data. Please refresh and try again.');
  return BigInt(value);
}

function tokenText(value) {
  if (!/^0x(?:[0-9a-f]{2})+$/i.test(value) || value.length < 130 || uint(value.slice(0, 66)) !== 32n) {
    throw new DemoError('RPC', 'Could not read the token identity. Please refresh.');
  }
  const length = uint(`0x${value.slice(66, 130)}`);
  if (length > 256n || value.length < 130 + Number(length) * 2) {
    throw new DemoError('RPC', 'Invalid token identity data.');
  }
  const hex = value.slice(130, 130 + Number(length) * 2);
  return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(hex.match(/.{2}/g) ?? [], (byte) => parseInt(byte, 16)));
}

export function formatUnits(value, decimals = 18, precision = 4) {
  const base = 10n ** BigInt(decimals);
  const integer = value / base;
  const fraction = (value % base).toString().padStart(decimals, '0').slice(0, precision).replace(/0+$/, '');
  return integer.toLocaleString('en-US') + (fraction ? `.${fraction}` : '');
}

export function isSepolia(chain) {
  try { return BigInt(chain) === BigInt(CONFIG.chainId); } catch { return false; }
}

export async function requireSepolia(provider) {
  if (!isSepolia(await provider.request({ method: 'eth_chainId' }))) {
    throw new DemoError('CHAIN', 'Switch to Ethereum Sepolia.');
  }
}

async function call(provider, to, data) {
  return provider.request({ method: 'eth_call', params: [{ to, data }, 'latest'] });
}

export async function readSnapshot(provider, account) {
  await requireSepolia(provider);
  const walletWord = addressWord(account);
  const traderWord = addressWord(CONFIG.trader);
  const tokenWord = addressWord(CONFIG.token);
  const values = await Promise.all([
    call(provider, CONFIG.token, SELECTORS.target),
    call(provider, CONFIG.trader, SELECTORS.token0),
    call(provider, CONFIG.trader, SELECTORS.token1),
    call(provider, CONFIG.token, SELECTORS.decimals),
    call(provider, CONFIG.token, SELECTORS.airdrop),
    call(provider, CONFIG.trader, SELECTORS.cap),
    call(provider, CONFIG.token, SELECTORS.claimed + walletWord),
    call(provider, CONFIG.token, SELECTORS.balance + walletWord),
    call(provider, CONFIG.usdc, SELECTORS.balance + traderWord),
    call(provider, CONFIG.eurc, SELECTORS.balance + traderWord),
    call(provider, CONFIG.usdc, SELECTORS.balance + tokenWord),
    call(provider, CONFIG.eurc, SELECTORS.balance + tokenWord),
    call(provider, CONFIG.token, SELECTORS.name),
    call(provider, CONFIG.token, SELECTORS.symbol),
  ]);
  const [target, token0, token1, decimals, airdrop, cap, claimed, balance, traderUsdc, traderEurc, tokenUsdc, tokenEurc] = values.slice(0, 12).map(uint);
  if (target !== BigInt(CONFIG.trader) || token0 !== BigInt(CONFIG.usdc) || token1 !== BigInt(CONFIG.eurc)
      || tokenText(values[12]) !== CONFIG.name || tokenText(values[13]) !== CONFIG.symbol
      || decimals !== 18n || airdrop !== 100n * 10n ** 18n || cap !== 1000000n || claimed > 1n) {
    throw new DemoError('CONFIG', 'The onchain configuration does not match Good Token. Claiming is disabled.');
  }
  await requireSepolia(provider);
  return { claimed: claimed === 1n, balance, airdrop, decimals: Number(decimals), cap, traderUsdc, traderEurc, tokenUsdc, tokenEurc };
}

export async function submitClaim(provider, expectedAccount) {
  await requireSepolia(provider);
  const accounts = await provider.request({ method: 'eth_accounts' });
  if (accounts[0]?.toLowerCase() !== expectedAccount.toLowerCase()) {
    throw new DemoError('ACCOUNT', 'Your wallet account changed. Refresh before claiming.');
  }
  // Validate the contract binding again immediately before any transaction request.
  const snapshot = await readSnapshot(provider, expectedAccount);
  if (snapshot.claimed) throw new DemoError('CLAIMED', 'This wallet has already claimed GTK.');
  const transaction = { from: expectedAccount, to: CONFIG.token, data: SELECTORS.claim, value: '0x0', chainId: CONFIG.chainId };
  await provider.request({ method: 'eth_estimateGas', params: [transaction] });
  await requireSepolia(provider);
  const latestAccounts = await provider.request({ method: 'eth_accounts' });
  if (latestAccounts[0]?.toLowerCase() !== expectedAccount.toLowerCase()) {
    throw new DemoError('ACCOUNT', 'Your wallet account changed. Please start the claim again.');
  }
  const hash = await provider.request({ method: 'eth_sendTransaction', params: [transaction] });
  if (!/^0x[0-9a-f]{64}$/i.test(hash)) throw new DemoError('HASH', 'The wallet did not return a valid transaction hash. Check the transaction status in your wallet before trying again.');
  return hash;
}

export async function waitForReceipt(provider, hash, { timeout = 180000, interval = 2500 } = {}) {
  const started = Date.now();
  do {
    await requireSepolia(provider);
    const receipt = await provider.request({ method: 'eth_getTransactionReceipt', params: [hash] });
    if (receipt) {
      if (BigInt(receipt.status) !== 1n) throw new DemoError('REVERTED', 'The transaction reverted. Check the block explorer for details.');
      if (receipt.transactionHash?.toLowerCase() !== hash.toLowerCase() || receipt.to?.toLowerCase() !== CONFIG.token) {
        throw new DemoError('RECEIPT', 'The transaction receipt does not match. Check the block explorer.');
      }
      return receipt;
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  } while (Date.now() - started < timeout);
  throw new DemoError('PENDING', 'Transaction submitted, but still awaiting confirmation. Check the transaction link and refresh once confirmed.');
}

export function errorMessage(error) {
  const code = error?.code ?? error?.error?.code;
  if (code === 4001 || code === 'ACTION_REJECTED') return 'You cancelled the wallet request. You can try again at any time.';
  if (code === -32002) return 'A wallet request is already pending. Open your wallet to complete it first.';
  if (code === 4902) return 'Enable Ethereum Sepolia in your wallet first.';
  if (error instanceof DemoError) return error.message;
  if (/insufficient funds/i.test(error?.message ?? '')) return 'Insufficient Sepolia ETH. Add a small amount of Sepolia ETH to cover gas.';
  return 'The wallet or network could not complete the request. Check your connection and refresh.';
}
