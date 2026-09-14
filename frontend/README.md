# Good Token airdrop page

The airdrop frontend for a demo that evaluates whether an agentic wallet detects potentially malicious tokens and unexpected transaction effects. Start with the MetaMask CLI and skill installation in the [project README](../README.md#step-1-install-the-metamask-cli-and-skill).

This is a static site with `dist/index.html` as its entry point. It uses EIP-1193 / EIP-6963 browser wallets to call the deployed Ethereum Sepolia contracts directly, without server-side private keys or RPC credentials.

Features include wallet discovery and connection, switching to Sepolia, reading claim eligibility and balances, reviewing a claim, sending `claimAirdrop()`, waiting for a successful receipt, and refreshing balances. The page handles already-claimed wallets, rejected signatures, network errors, insufficient gas, and pending transactions. It does not explain the contract interactions in advance; participants can discover them through transaction records.

Run these commands from the `frontend/` directory:

```sh
python3 -m http.server 4173 --directory dist
node --test test/chain.test.mjs
```

Open the local page in a browser with a wallet extension, or open the deployed URL in a mobile wallet's built-in browser. If the Codex preview has no injected wallet, the page displays instructions to install or open a wallet.

`dist/chain.mjs` contains this project's fixed Sepolia addresses. The only transaction the page sends is `claimAirdrop()`, with zero ETH value. The page does not read the repository's root `.env`. When changing deployment addresses, update the addresses and expected parameters in `chain.mjs`, then verify them again.

Each wallet can claim only once. For another classroom demonstration, use a wallet that has not claimed yet or deploy another set of contracts. The instructor must fund Trader with test USDC and EURC before demonstrating the token flow.

Interface references: [EIP-1193](https://eips.ethereum.org/EIPS/eip-1193), [EIP-6963](https://eips.ethereum.org/EIPS/eip-6963), and [MetaMask Ethereum Provider](https://docs.metamask.io/wallet/reference/provider-api/).
