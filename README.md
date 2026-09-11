# Sepolia callback demo

合约源码位于 `contracts/trader.sol` 和 `contracts/token.sol`，部署脚本位于 `script/Deploy.s.sol`。

空投前端位于 `frontend/`，提供连接钱包、领取 100 GTK 和课堂实验余额展示，使用说明见 [frontend/README.md](frontend/README.md)。

当前前端使用新部署的 **Good Token（GTK）**，并复用原有 Trader。新 token 的独立部署记录在 `deployments/sepolia-good-token.json`，原始部署记录仍保存在 `deployments/sepolia.json`。可通过 `make simulate-good-token` 模拟、`make deploy-good-token` 部署、`make verify-good-token` 重新核对已有部署。已存在广播记录时不会重复部署。

演示 Uniswap V3 swap callback **未验证调用者**的问题：`VulnerableTrader` 会向任意 callback 调用者支付 token；`MaliciousAirdropToken` 在领取空投、普通转账时触发该 callback。USDC / EURC 先进入 demo token 合约，部署者可调用 `withdraw()` 取回。单次支付上限按每种资产计算，重复调用仍可继续转出余额。

## 一键部署

需要 Foundry（`forge`、`cast`）、Node.js 20.12+、可支付 gas 的 Sepolia 测试账户。

```sh
make install
cp .env.example .env  # 已有 .env 时跳过，避免覆盖配置
```

在本地 `.env` 填入 `SEPOLIA_RPC_URL` 和 `DEPLOYER_PRIVATE_KEY`。脚本支持项目已有的这两个变量，不需要手动填 trader 地址。

```sh
make test
make simulate  # 连接 Sepolia，模拟两笔部署，不广播
make deploy    # 按顺序部署 trader、token，并读取链上配置确认
```

部署流程固定为：

1. 检查 RPC 的 chain ID 为 `11155111`，并检查官方测试币合约存在、精度均为 6。
2. 部署 `VulnerableTrader(USDC, EURC, MAX_CALLBACK_PAYMENT)`。
3. 用上一步地址部署 `MaliciousAirdropToken(trader, AIRDROP_AMOUNT, TOKEN_NAME, TOKEN_SYMBOL, TOKEN_DECIMALS)`。
4. 确认交易 receipt、两个 owner、trader 的币种和 token 的 `targetTrader`，写入 `deployments/sepolia.json`。

两个合约的 owner 均为签名账户。`targetTrader` 是 immutable，部署时自动设置，之后不能更换。

`deployments/sepolia.json` 包含合约地址、交易哈希、区块号、浏览器链接及参数；Foundry 完整广播记录在 `broadcast/Deploy.s.sol/11155111/`。模拟不会生成已部署清单。如果广播中断，保留原账户、RPC、参数及 nonce，用 `make resume` 恢复。脚本发现已有广播记录时会阻止重新部署；如需新一组 demo，先归档 `broadcast/Deploy.s.sol/11155111/` 和 `deployments/sepolia.json`。

可选：使用 Foundry 加密 keystore 替代 `.env` 私钥：

```sh
cast wallet import sepolia-demo --interactive
```

删除 `.env` 中的 `DEPLOYER_PRIVATE_KEY`，设置 `FOUNDRY_ACCOUNT=sepolia-demo` 和该账户的公开 `DEPLOYER_ADDRESS`。无人值守运行还可设置 `KEYSTORE_PASSWORD_FILE`。私钥不通过脚本命令参数传入，`.env` 和广播缓存均已加入 `.gitignore`。

## 测试币和参数

| 参数 | 默认值 / 地址 |
| --- | --- |
| 网络 | Ethereum Sepolia，`11155111` |
| trader.token0 / token.TOKEN0 | USDC：`0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238` |
| trader.token1 / token.TOKEN1 | EURC：`0x08210F9170F89Ab7658F0B5E3fF39b0E03C594D4` |
| MAX_CALLBACK_PAYMENT | `1000000`，每次每种资产最多 1 枚 |
| AIRDROP_AMOUNT | `100000000000000000000`，默认精度下为 100 枚 demo token |
| TOKEN_NAME / TOKEN_SYMBOL | `Good Token` / `GTK` |
| TOKEN_DECIMALS | `18` |

地址来源：[Circle USDC](https://developers.circle.com/stablecoins/usdc-contract-addresses)、[Circle EURC](https://developers.circle.com/stablecoins/eurc-contract-addresses)。测试币可从 [Circle Faucet](https://faucet.circle.com/) 获取。`MAX_CALLBACK_PAYMENT`、`AIRDROP_AMOUNT` 均填写整数最小单位；改变 `TOKEN_DECIMALS` 后需相应调整 `AIRDROP_AMOUNT`。

部署后 trader 的初始余额为零。要展示资金流，从自己的测试钱包向 trader 转入测试 USDC / EURC，或先 `approve(trader, amount)` 再调用 `deposit(token, amount)`。随后对新部署的 demo token 调用 `claimAirdrop()` 或普通 `transfer()`，即可观察 callback 和余额变化。部署命令本身只创建两个合约，不执行充值、空投或提款。

`make test` 使用本地 mock 币，覆盖自动部署关联、两种签名方式、链及币种检查、领取 / 转账触发支付、上限及剩余余额、提款归属和部署记录校验，无需 RPC 或测试币。部署流程使用 [Foundry Solidity scripting](https://getfoundry.sh/reference/cheatcodes/start-broadcast)。
