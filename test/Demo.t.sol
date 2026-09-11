// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Deploy} from "../script/Deploy.s.sol";
import {VulnerableTrader} from "../contracts/trader.sol";
import {MaliciousAirdropToken} from "../contracts/token.sol";

contract MockStablecoin is ERC20 {
    constructor() ERC20("Test stablecoin", "TEST") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract DeployHarness is Deploy {
    function deploy(Config memory config) external returns (VulnerableTrader, MaliciousAirdropToken) {
        return _deploy(config);
    }
}

contract DemoTest is Test {
    DeployHarness private deployScript;
    Deploy.Config private config;
    MockStablecoin private usdc;
    MockStablecoin private eurc;
    address private deployer;
    address private alice = address(0xA11CE);
    address private bob = address(0xB0B);

    function setUp() public {
        deployer = vm.addr(0x1234);
        vm.chainId(11155111);
        deployScript = new DeployHarness();
        config = Deploy.Config(0, deployer, 1e6, 100e18, 18, "Good Token", "GTK");
        MockStablecoin implementation = new MockStablecoin();
        vm.etch(deployScript.USDC(), address(implementation).code);
        vm.etch(deployScript.EURC(), address(implementation).code);
        usdc = MockStablecoin(deployScript.USDC());
        eurc = MockStablecoin(deployScript.EURC());
        vm.deal(deployer, 10 ether);
        // Explicit test-only values override any local .env, including the real signing key.
        vm.setEnv("DEPLOYER_PRIVATE_KEY", "0");
        vm.setEnv("DEPLOYER_ADDRESS", vm.toString(deployer));
        vm.setEnv("MAX_CALLBACK_PAYMENT", "1000000");
        vm.setEnv("AIRDROP_AMOUNT", "100000000000000000000");
        vm.setEnv("TOKEN_DECIMALS", "18");
        vm.setEnv("TOKEN_NAME", "Good Token");
        vm.setEnv("TOKEN_SYMBOL", "GTK");
    }

    function testDeploymentLinksTraderAndTokensAndPreservesOwner() public {
        (VulnerableTrader trader, MaliciousAirdropToken token) = deployScript.run();
        assertEq(address(trader.token0()), address(usdc));
        assertEq(address(trader.token1()), address(eurc));
        assertEq(token.targetTrader(), address(trader));
        assertEq(token.TOKEN0(), address(usdc));
        assertEq(token.TOKEN1(), address(eurc));
        assertEq(trader.owner(), deployer);
        assertEq(token.owner(), deployer);
        assertEq(trader.maxCallbackPayment(), 1e6);
        assertEq(token.airdropAmount(), 100e18);
        assertEq(token.name(), "Good Token");
        assertEq(token.decimals(), 18);
    }

    function testPrivateKeyDeploymentUsesSignerAsOwner() public {
        config.privateKey = 0x1234;
        (VulnerableTrader trader, MaliciousAirdropToken token) = deployScript.deploy(config);
        assertEq(trader.owner(), deployer);
        assertEq(token.owner(), deployer);
    }

    function testRejectsOtherNetworks() public {
        vm.chainId(1);
        vm.expectRevert("Deploy only supports Ethereum Sepolia (11155111)");
        deployScript.deploy(config);
    }

    function testRejectsMissingStablecoin() public {
        vm.etch(address(eurc), bytes(""));
        vm.expectRevert("Missing Sepolia stablecoin contracts");
        deployScript.deploy(config);
    }

    function testRejectsUnexpectedStablecoinDecimals() public {
        vm.mockCall(address(eurc), abi.encodeWithSignature("decimals()"), abi.encode(uint8(18)));
        vm.expectRevert("Expected 6-decimal USDC and EURC");
        deployScript.deploy(config);
    }

    function testRejectsInvalidCapBeforeDeploying() public {
        config.cap = 0;
        vm.expectRevert("Invalid MAX_CALLBACK_PAYMENT");
        deployScript.deploy(config);
    }

    function testRejectsDecimalsOverflowBeforeDeploying() public {
        config.tokenDecimals = 256;
        vm.expectRevert("TOKEN_DECIMALS exceeds uint8");
        deployScript.deploy(config);
    }

    function testClaimAndTransferTriggerCappedPaymentsThenOwnerWithdraws() public {
        (VulnerableTrader trader, MaliciousAirdropToken token) = deployScript.run();
        usdc.mint(deployer, 2e6);
        eurc.mint(deployer, 15e5);
        vm.startPrank(deployer);
        usdc.approve(address(trader), 2e6);
        eurc.approve(address(trader), 15e5);
        trader.deposit(address(usdc), 2e6);
        trader.deposit(address(eurc), 15e5);
        vm.stopPrank();

        vm.prank(alice);
        token.claimAirdrop();
        assertEq(token.balanceOf(alice), 100e18);
        assertEq(usdc.balanceOf(address(token)), 1e6);
        assertEq(eurc.balanceOf(address(token)), 1e6);
        assertEq(usdc.balanceOf(address(trader)), 1e6);
        assertEq(eurc.balanceOf(address(trader)), 5e5);

        vm.prank(alice);
        token.transfer(bob, 1e18);
        assertEq(token.balanceOf(bob), 1e18);
        assertEq(usdc.balanceOf(address(trader)), 0);
        assertEq(eurc.balanceOf(address(trader)), 0);

        vm.expectRevert(abi.encodeWithSelector(MaliciousAirdropToken.NotOwner.selector, alice));
        vm.prank(alice);
        token.withdraw();
        vm.prank(deployer);
        token.withdraw();
        assertEq(usdc.balanceOf(deployer), 2e6);
        assertEq(eurc.balanceOf(deployer), 15e5);
        assertEq(usdc.balanceOf(address(token)), 0);
        assertEq(eurc.balanceOf(address(token)), 0);
    }

    function testEmptyTraderAllowsClaimAndTransferButCannotClaimTwice() public {
        (, MaliciousAirdropToken token) = deployScript.run();
        vm.startPrank(alice);
        token.claimAirdrop();
        token.transfer(bob, 1e18);
        vm.expectRevert(abi.encodeWithSelector(MaliciousAirdropToken.AlreadyClaimed.selector, alice));
        token.claimAirdrop();
        vm.stopPrank();
        assertEq(token.balanceOf(bob), 1e18);
    }

    function testUnauthenticatedCallbackRemainsReproducibleAndCapIsEnforced() public {
        (VulnerableTrader trader,) = deployScript.run();
        usdc.mint(address(trader), 2e6);
        vm.startPrank(alice);
        vm.expectRevert(abi.encodeWithSelector(VulnerableTrader.PaymentExceedsCap.selector, 1e6 + 1, 1e6));
        trader.uniswapV3SwapCallback(1e6 + 1, 0, bytes(""));
        trader.uniswapV3SwapCallback(1e6, 0, bytes(""));
        vm.stopPrank();
        assertEq(usdc.balanceOf(alice), 1e6);
    }

    function testTokenRejectsTraderWithReversedStablecoins() public {
        VulnerableTrader trader = new VulnerableTrader(IERC20(address(eurc)), IERC20(address(usdc)), 1e6);
        vm.expectRevert(
            abi.encodeWithSelector(MaliciousAirdropToken.UnexpectedTraderTokens.selector, address(eurc), address(usdc))
        );
        new MaliciousAirdropToken(address(trader), 100e18, "Demo", "DEMO", 18);
    }
}
