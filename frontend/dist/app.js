import { CONFIG, DemoError, errorMessage, formatUnits, isSepolia, readSnapshot, submitClaim, waitForReceipt } from './chain.mjs';

const $ = (id) => document.getElementById(id);
const shortAddress = (value) => `${value.slice(0, 6)}…${value.slice(-5)}`;
const wallets = new Map();
let provider = null;
let account = null;
let snapshot = null;
let wrongChain = false;
let busy = false;
let checking = false;
let revision = 0;
let pendingHash = null;
let pendingAccount = null;
let accountHandler;
let chainHandler;
let disconnectHandler;

function status(message = '', kind = '') {
  $('status').hidden = !message;
  $('status').textContent = message;
  $('status').dataset.kind = kind;
}

function render() {
  $('wallet-address').textContent = account ? shortAddress(account) : 'Not connected';
  $('wallet-address').title = account ?? '';
  $('connect-header').textContent = account ? shortAddress(account) : 'Connect wallet ↗';
  $('connect-header').disabled = busy;
  $('connected-actions').hidden = !account;
  $('refresh-button').disabled = busy || checking;
  $('disconnect-button').disabled = busy;
  $('user-balance').textContent = snapshot ? `${formatUnits(snapshot.balance)} GTK` : '—';
  $('eligibility').textContent = !account ? 'Connect to check' : wrongChain ? 'Switch network' : checking ? 'Reading onchain status' : snapshot ? (snapshot.claimed ? 'Claimed' : 'Eligible') : 'Refresh required';
  const button = $('claim-button');
  button.disabled = busy || checking || Boolean(snapshot?.claimed) || Boolean(!wrongChain && pendingHash && pendingAccount === account?.toLowerCase());
  button.textContent = busy ? 'Waiting for confirmation…' : checking ? 'Checking…' : !account ? 'Connect wallet to claim ↗' : wrongChain ? 'Switch to Sepolia ↗' : snapshot?.claimed ? '100 GTK claimed ✓' : pendingHash && pendingAccount === account?.toLowerCase() ? 'Transaction pending' : !snapshot ? 'Reload onchain status' : 'Claim 100 GTK ↗';

}

async function refresh({ preserveStatus = false } = {}) {
  const currentProvider = provider;
  if (!currentProvider) return;
  const current = ++revision;
  checking = true;
  snapshot = null;
  render();
  try {
    const [accounts, chain] = await Promise.all([
      currentProvider.request({ method: 'eth_accounts' }),
      currentProvider.request({ method: 'eth_chainId' }),
    ]);
    if (current !== revision || currentProvider !== provider) return;
    account = accounts[0] ?? null;
    wrongChain = !isSepolia(chain);
    if (!account) { if (!preserveStatus) status('Connect a wallet to check your eligibility.'); return; }
    if (wrongChain) { if (!preserveStatus) status('Your wallet is on another network. Switch to Ethereum Sepolia.'); return; }
    const value = await readSnapshot(currentProvider, account);
    if (current !== revision || currentProvider !== provider) return;
    snapshot = value;
    if (snapshot.claimed && pendingAccount === account.toLowerCase()) { pendingHash = null; pendingAccount = null; }
    if (pendingHash && pendingAccount === account.toLowerCase()) {
      const receipt = await currentProvider.request({ method: 'eth_getTransactionReceipt', params: [pendingHash] });
      if (current !== revision) return;
      if (receipt && BigInt(receipt.status) === 0n) {
        pendingHash = null;
        pendingAccount = null;
        status('The previous transaction reverted. You can try claiming again.', 'error');
      } else if (!preserveStatus) status('Transaction submitted. Refresh after it confirms onchain.');
    } else if (!preserveStatus) status(snapshot.claimed ? 'This wallet has already claimed the airdrop.' : 'Wallet connected. You can claim 100 GTK.', snapshot.claimed ? '' : 'success');
  } catch (error) {
    if (current === revision) { snapshot = null; status(errorMessage(error), 'error'); }
  } finally {
    if (current === revision) { checking = false; render(); }
  }
}

function detach() {
  provider?.removeListener?.('accountsChanged', accountHandler);
  provider?.removeListener?.('chainChanged', chainHandler);
  provider?.removeListener?.('disconnect', disconnectHandler);
  revision += 1;
  checking = false;
}

function attach(nextProvider) {
  detach();
  provider = nextProvider;
  accountHandler = () => { $('claim-dialog').close(); snapshot = null; refresh(); };
  chainHandler = () => { $('claim-dialog').close(); snapshot = null; refresh(); };
  disconnectHandler = () => { detach(); provider = null; account = null; snapshot = null; wrongChain = false; status('Wallet disconnected.'); render(); };
  provider.on?.('accountsChanged', accountHandler);
  provider.on?.('chainChanged', chainHandler);
  provider.on?.('disconnect', disconnectHandler);
}

async function connect(nextProvider) {
  if (busy) return;
  busy = true;
  render();
  $('wallet-dialog').close();
  try {
    const accounts = await nextProvider.request({ method: 'eth_requestAccounts' });
    if (!accounts[0]) throw new DemoError('ACCOUNT', 'No account was provided. Reconnect your wallet.');
    attach(nextProvider);
    account = accounts[0];
    await refresh();
  } catch (error) { status(errorMessage(error), 'error'); }
  finally { busy = false; render(); }
}

function renderWallets() {
  const list = $('wallet-list');
  list.replaceChildren();
  const choices = [...wallets.values()];
  if (!choices.length && window.ethereum) choices.push({ name: window.ethereum.isMetaMask ? 'MetaMask' : 'Browser wallet', provider: window.ethereum });
  for (const wallet of choices) {
    const button = document.createElement('button');
    button.className = 'wallet-option';
    button.textContent = `${wallet.name} ↗`;
    button.addEventListener('click', () => connect(wallet.provider));
    list.append(button);
  }
  $('wallet-help').hidden = choices.length > 0;
  $('wallet-install').hidden = choices.length > 0;
}

window.addEventListener('eip6963:announceProvider', (event) => {
  const detail = event.detail;
  if (!detail?.info?.uuid || typeof detail?.provider?.request !== 'function') return;
  wallets.set(detail.info.uuid, { name: String(detail.info.name).slice(0, 60), provider: detail.provider });
  if ($('wallet-dialog').open) renderWallets();
});
window.dispatchEvent(new Event('eip6963:requestProvider'));

function showWallets() {
  if (busy) return;
  renderWallets();
  $('wallet-dialog').showModal();
  window.dispatchEvent(new Event('eip6963:requestProvider'));
}

async function switchNetwork() {
  if (!provider || busy) return;
  busy = true;
  render();
  try {
    await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: CONFIG.chainId }] });
    await refresh();
  } catch (error) { status(errorMessage(error), 'error'); }
  finally { busy = false; render(); }
}

async function claim() {
  if (busy || !provider || !account || !snapshot || snapshot.claimed) return;
  const claimProvider = provider;
  const claimAccount = account;
  busy = true;
  $('claim-dialog').close();
  status('Review and confirm the claim transaction in your wallet.');
  render();
  try {
    const hash = await submitClaim(claimProvider, claimAccount);
    pendingHash = hash;
    pendingAccount = claimAccount.toLowerCase();
    $('transaction-link').href = `${CONFIG.explorer}/tx/${hash}`;
    $('transaction-link').hidden = false;
    status('Transaction submitted. Waiting for Sepolia confirmation…');
    await waitForReceipt(claimProvider, hash);
    pendingHash = null;
    pendingAccount = null;
    status(`Claim successful! 100 GTK was sent to ${shortAddress(claimAccount)}.`, 'success');
    await refresh({ preserveStatus: true });
  } catch (error) {
    if (error?.code === 'REVERTED') { pendingHash = null; pendingAccount = null; }
    status(errorMessage(error), error?.code === 'PENDING' ? '' : 'error');
    await refresh({ preserveStatus: true });
  } finally { busy = false; render(); }
}

$('connect-header').addEventListener('click', showWallets);
$('claim-button').addEventListener('click', () => {
  if (busy || checking) return;
  if (!account) showWallets();
  else if (wrongChain) switchNetwork();
  else if (!snapshot) refresh();
  else if (!snapshot.claimed) $('claim-dialog').showModal();
});
$('confirm-claim').addEventListener('click', claim);
$('refresh-button').addEventListener('click', () => refresh());
$('disconnect-button').addEventListener('click', () => { detach(); provider = null; account = null; snapshot = null; wrongChain = false; status('Disconnected from this page. Manage site permissions in your wallet settings.'); render(); });
document.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', () => $(button.dataset.close).close()));
render();
