// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {TransferAndFundTrader} from "../script/TransferAndFundTrader.s.sol";
import {VulnerableTrader} from "../contracts/trader.sol";
import {MockStablecoin} from "./Demo.t.sol";

contract TransferAndFundHarness is TransferAndFundTrader {
    function execute(address trader, address newOwner, uint256 ownerKey) external {
        _transferAndFund(trader, newOwner, ownerKey);
    }
}

contract TransferAndFundTraderTest is Test {
    TransferAndFundHarness private script;
    VulnerableTrader private trader;
    MockStablecoin private usdc;
    MockStablecoin private eurc;
    uint256 private constant OWNER_KEY = 0x1234;
    uint256 private constant NEW_OWNER_KEY = 0x5678;
    address private oldOwner;
    address private newOwner;

    function setUp() public {
        vm.chainId(11155111);
        oldOwner = vm.addr(OWNER_KEY);
        newOwner = vm.addr(NEW_OWNER_KEY);
        script = new TransferAndFundHarness();
        MockStablecoin implementation = new MockStablecoin();
        vm.etch(script.USDC(), address(implementation).code);
        vm.etch(script.EURC(), address(implementation).code);
        usdc = MockStablecoin(script.USDC());
        eurc = MockStablecoin(script.EURC());
        vm.prank(oldOwner);
        trader = new VulnerableTrader(usdc, eurc, 1e6);
        vm.deal(oldOwner, 1 ether);
        // The recipient requires no key, gas or stablecoin balance.
        usdc.mint(oldOwner, 3e6);
        eurc.mint(oldOwner, 2e6);
    }

    function execute() private {
        script.execute(address(trader), newOwner, OWNER_KEY);
    }

    function testLocalOwnerTransfersOwnershipAndFundsWithoutRecipientKey() public {
        execute();
        assertEq(trader.owner(), newOwner);
        assertEq(usdc.balanceOf(address(trader)), 1e6);
        assertEq(eurc.balanceOf(address(trader)), 1e6);
        assertEq(usdc.balanceOf(newOwner), 0);
        assertEq(eurc.balanceOf(newOwner), 0);
        assertEq(usdc.balanceOf(oldOwner), 2e6);
        assertEq(eurc.balanceOf(oldOwner), 1e6);
        assertEq(usdc.allowance(oldOwner, address(trader)), 0);
        assertEq(eurc.allowance(oldOwner, address(trader)), 0);
    }

    function testRejectsWrongNetwork() public {
        vm.chainId(1);
        vm.expectRevert("Ethereum Sepolia only");
        execute();
    }

    function testAlreadyAssignedOwnerOnlyFundsFromLocalSigner() public {
        vm.prank(oldOwner);
        trader.transferOwner(newOwner);
        execute();
        assertEq(trader.owner(), newOwner);
        assertEq(usdc.balanceOf(address(trader)), 1e6);
        assertEq(eurc.balanceOf(address(trader)), 1e6);
        assertEq(usdc.balanceOf(newOwner), 0);
    }

    function testRejectsUnrelatedCurrentOwnerBeforeFunding() public {
        vm.prank(oldOwner);
        trader.transferOwner(address(0xBEEF));
        vm.expectRevert("Local signer cannot transfer current ownership");
        execute();
        assertEq(usdc.balanceOf(address(trader)), 0);
        assertEq(eurc.balanceOf(address(trader)), 0);
    }

    function testRejectsZeroRecipient() public {
        vm.expectRevert("Invalid new owner");
        script.execute(address(trader), address(0), OWNER_KEY);
    }

    function testChecksBothBalancesBeforeTransferringOwnership() public {
        vm.prank(oldOwner);
        eurc.transfer(address(0xBEEF), 2e6);
        vm.expectRevert("Local signer needs 1 EURC");
        execute();
        assertEq(trader.owner(), oldOwner);
        assertEq(usdc.balanceOf(address(trader)), 0);
    }

    function testRejectsInsufficientUsdc() public {
        vm.prank(oldOwner);
        usdc.transfer(address(0xBEEF), 3e6);
        vm.expectRevert("Local signer needs 1 USDC");
        execute();
        assertEq(trader.owner(), oldOwner);
    }

    function testRejectsMissingGasBeforeTransferringOwnership() public {
        vm.deal(oldOwner, 0);
        vm.expectRevert("Local signer needs Sepolia ETH for gas");
        execute();
        assertEq(trader.owner(), oldOwner);
    }

    function testRejectsUnexpectedTraderTokens() public {
        vm.mockCall(address(trader), abi.encodeWithSignature("token0()"), abi.encode(address(0xBEEF)));
        vm.expectRevert("Unexpected Trader tokens");
        execute();
    }

    function testRejectsWrongTokenDecimals() public {
        vm.mockCall(address(eurc), abi.encodeWithSignature("decimals()"), abi.encode(uint8(18)));
        vm.expectRevert("Expected 6-decimal stablecoins");
        execute();
    }
}
