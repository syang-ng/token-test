// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {VulnerableTrader} from "../contracts/trader.sol";
import {MaliciousAirdropToken} from "../contracts/token.sol";

/// @notice Deploys Good Token (GTK), using the existing classroom Trader.
contract DeployGoodToken is Script {
    function run() public returns (MaliciousAirdropToken token) {
        uint256 key = vm.envOr("DEPLOYER_PRIVATE_KEY", uint256(0));
        address deployer = key == 0 ? vm.envAddress("DEPLOYER_ADDRESS") : vm.addr(key);
        address traderAddress = vm.envAddress("TRADER_ADDRESS");
        return _deploy(traderAddress, deployer, key);
    }

    function _deploy(address traderAddress, address deployer, uint256 key)
        internal
        returns (MaliciousAirdropToken token)
    {
        require(block.chainid == 11155111, "Ethereum Sepolia only");
        require(deployer != address(0), "Missing deployer");
        require(traderAddress.code.length > 0, "Trader contract missing");
        VulnerableTrader trader = VulnerableTrader(traderAddress);
        require(trader.owner() == deployer, "Trader must belong to the deployer");
        require(trader.maxCallbackPayment() == 1e6, "Unexpected classroom payment cap");

        if (key == 0) vm.startBroadcast(deployer);
        else vm.startBroadcast(key);
        token = new MaliciousAirdropToken(traderAddress, 100e18, "Good Token", "GTK", 18);
        vm.stopBroadcast();

        require(token.owner() == deployer && token.targetTrader() == traderAddress, "Incorrect deployment binding");
        console2.log("Good Token (GTK):", address(token));
        console2.log("Existing Trader:", traderAddress);
        console2.log("Owner:", deployer);
    }
}
