// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script} from "forge-std/Script.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20, IERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {VulnerableTrader} from "../contracts/trader.sol";

contract TransferAndFundTrader is Script {
    using SafeERC20 for IERC20;

    address public constant USDC = 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238;
    address public constant EURC = 0x08210F9170F89Ab7658F0B5E3fF39b0E03C594D4;
    uint256 public constant AMOUNT = 1e6;

    function run() public {
        _transferAndFund(
            vm.envAddress("TRADER_ADDRESS"),
            vm.envAddress("NEW_OWNER_ADDRESS"),
            vm.envUint("DEPLOYER_PRIVATE_KEY"),
            vm.envUint("NEW_OWNER_PRIVATE_KEY")
        );
    }

    function _transferAndFund(address target, address newOwner, uint256 ownerKey, uint256 newOwnerKey) internal {
        require(block.chainid == 11155111, "Ethereum Sepolia only");
        require(target.code.length > 0, "Trader contract missing");
        require(newOwner != address(0) && newOwner != target, "Invalid new owner");
        require(ownerKey != 0 && newOwnerKey != 0, "Both signing keys are required");
        address oldOwner = vm.addr(ownerKey);
        require(vm.addr(newOwnerKey) == newOwner, "New owner key/address mismatch");
        require(oldOwner != newOwner, "New owner must differ from current owner");
        VulnerableTrader trader = VulnerableTrader(target);
        require(trader.owner() == oldOwner, "Current owner key mismatch");
        require(address(trader.token0()) == USDC && address(trader.token1()) == EURC, "Unexpected Trader tokens");
        require(USDC.code.length > 0 && EURC.code.length > 0, "Stablecoin contracts missing");
        require(
            IERC20Metadata(USDC).decimals() == 6 && IERC20Metadata(EURC).decimals() == 6,
            "Expected 6-decimal stablecoins"
        );
        require(IERC20(USDC).balanceOf(newOwner) >= AMOUNT, "New owner needs 1 USDC");
        require(IERC20(EURC).balanceOf(newOwner) >= AMOUNT, "New owner needs 1 EURC");
        require(oldOwner.balance > 0 && newOwner.balance > 0, "Both owners need Sepolia ETH for gas");

        vm.startBroadcast(ownerKey);
        trader.transferOwner(newOwner);
        vm.stopBroadcast();

        vm.startBroadcast(newOwnerKey);
        IERC20(USDC).safeTransfer(target, AMOUNT);
        IERC20(EURC).safeTransfer(target, AMOUNT);
        vm.stopBroadcast();
    }
}
