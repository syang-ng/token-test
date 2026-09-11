// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {VulnerableTrader} from "../contracts/trader.sol";
import {MaliciousAirdropToken} from "../contracts/token.sol";

/// @notice Deploys the two demo contracts, in order, on Ethereum Sepolia.
contract Deploy is Script {
    uint256 public constant CHAIN_ID = 11155111;
    // Circle's canonical Ethereum Sepolia token addresses, in the order token.sol requires.
    address public constant USDC = 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238;
    address public constant EURC = 0x08210F9170F89Ab7658F0B5E3fF39b0E03C594D4;

    struct Config {
        uint256 privateKey;
        address deployer;
        uint256 cap;
        uint256 airdrop;
        uint256 tokenDecimals;
        string tokenName;
        string tokenSymbol;
    }

    function run() public returns (VulnerableTrader trader, MaliciousAirdropToken token) {
        uint256 privateKey = vm.envOr("DEPLOYER_PRIVATE_KEY", uint256(0));
        Config memory config = Config({
            privateKey: privateKey,
            deployer: privateKey == 0 ? vm.envAddress("DEPLOYER_ADDRESS") : vm.addr(privateKey),
            cap: vm.envOr("MAX_CALLBACK_PAYMENT", uint256(1e6)),
            airdrop: vm.envOr("AIRDROP_AMOUNT", uint256(100e18)),
            tokenDecimals: vm.envOr("TOKEN_DECIMALS", uint256(18)),
            tokenName: vm.envOr("TOKEN_NAME", string("Good Token")),
            tokenSymbol: vm.envOr("TOKEN_SYMBOL", string("GTK"))
        });
        return _deploy(config);
    }

    function _deploy(Config memory config) internal returns (VulnerableTrader trader, MaliciousAirdropToken token) {
        require(block.chainid == CHAIN_ID, "Deploy only supports Ethereum Sepolia (11155111)");
        require(USDC.code.length > 0 && EURC.code.length > 0, "Missing Sepolia stablecoin contracts");
        require(
            IERC20Metadata(USDC).decimals() == 6 && IERC20Metadata(EURC).decimals() == 6,
            "Expected 6-decimal USDC and EURC"
        );

        require(config.deployer != address(0), "DEPLOYER_ADDRESS must be nonzero");
        require(config.cap > 0 && config.cap <= uint256(type(int256).max), "Invalid MAX_CALLBACK_PAYMENT");
        require(config.airdrop > 0, "AIRDROP_AMOUNT must be positive");
        require(config.tokenDecimals <= type(uint8).max, "TOKEN_DECIMALS exceeds uint8");

        if (config.privateKey == 0) {
            vm.startBroadcast(config.deployer);
        } else {
            vm.startBroadcast(config.privateKey);
        }
        trader = new VulnerableTrader(IERC20(USDC), IERC20(EURC), config.cap);
        token = new MaliciousAirdropToken(
            address(trader), config.airdrop, config.tokenName, config.tokenSymbol, uint8(config.tokenDecimals)
        );
        vm.stopBroadcast();

        require(trader.owner() == config.deployer && token.owner() == config.deployer, "Unexpected deployment owner");
        require(token.targetTrader() == address(trader), "Unexpected trader target");
        console2.log("VulnerableTrader:", address(trader));
        console2.log("MaliciousAirdropToken:", address(token));
        console2.log("Owner:", config.deployer);
        console2.log("USDC (token0):", USDC);
        console2.log("EURC (token1):", EURC);
    }
}
