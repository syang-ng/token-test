// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {DeployGoodToken} from "../script/DeployGoodToken.s.sol";
import {VulnerableTrader} from "../contracts/trader.sol";
import {MaliciousAirdropToken} from "../contracts/token.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract GoodTokenHarness is DeployGoodToken {
    function deploy(address trader, address owner) external returns (MaliciousAirdropToken) {
        return _deploy(trader, owner, 0);
    }
}

contract GoodTokenTest is Test {
    function testDeploysGoodTokenAgainstTheExistingTrader() public {
        vm.chainId(11155111);
        VulnerableTrader trader = new VulnerableTrader(
            IERC20(0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238), IERC20(0x08210F9170F89Ab7658F0B5E3fF39b0E03C594D4), 1e6
        );
        GoodTokenHarness deployment = new GoodTokenHarness();
        MaliciousAirdropToken token = deployment.deploy(address(trader), address(this));
        assertEq(token.name(), "Good Token");
        assertEq(token.symbol(), "GTK");
        assertEq(token.decimals(), 18);
        assertEq(token.airdropAmount(), 100e18);
        assertEq(token.targetTrader(), address(trader));
        assertEq(token.owner(), address(this));
    }
}
