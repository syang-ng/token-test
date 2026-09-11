# Good Token 空投页面

静态课堂演示站点，入口为 `dist/index.html`。使用 EIP-1193 / EIP-6963 浏览器钱包直接调用已经部署的 Ethereum Sepolia 合约，无服务器私钥和 RPC 密钥。

功能：连接和选择钱包、切换 Sepolia、读取领取资格和余额、显示领取交易说明、发送 `claimAirdrop()`、等待成功回执及刷新余额。已领取、取消签名、网络错误、Gas 不足、待确认交易均有状态处理。页面不提前解释领取时的合约交互，参与者可通过交易记录自行探索。

```sh
python3 -m http.server 4173 --directory dist
node --test test/chain.test.mjs
```

在安装钱包扩展的浏览器打开本地页面，或使用手机钱包内置浏览器打开部署后的网址。Codex 内置预览如果没有注入钱包，会展示安装 / 打开钱包提示。

`dist/chain.mjs` 固定了本项目的 Sepolia 地址，页面发送的唯一交易为 `claimAirdrop()`，ETH value 为零。页面不会读取仓库根目录的 `.env`。修改部署地址时同步更新 `chain.mjs` 中的地址及预期参数，并再次验证。

每个钱包只能领取一次；要再次课堂演示，请换一个尚未领取的钱包或部署新一组合约。观察测试币流动之前，需要老师向 Trader 充值测试 USDC / EURC。

接口依据：[EIP-1193](https://eips.ethereum.org/EIPS/eip-1193)、[EIP-6963](https://eips.ethereum.org/EIPS/eip-6963)、[MetaMask Ethereum Provider](https://docs.metamask.io/wallet/reference/provider-api/)。
