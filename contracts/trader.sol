// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

interface IUniswapV3SwapCallback {
    /// @notice Pays positive token deltas to the callback caller.
    /// @param amount0Delta Positive when token0 is owed.
    /// @param amount1Delta Positive when token1 is owed.
    /// @param data Opaque callback data; unused by this controlled experiment.
    function uniswapV3SwapCallback(int256 amount0Delta, int256 amount1Delta, bytes calldata data) external;
}

/// @title VulnerableTrader
/// @notice Deliberately vulnerable callback payer for controlled security testing.
contract VulnerableTrader is IUniswapV3SwapCallback {
    using SafeERC20 for IERC20;

    error UnsupportedChain(uint256 chainId);
    error ZeroAddress();
    error InvalidMaxCallbackPayment();
    error UnsupportedDepositToken(address token);
    error InvalidDeltas();
    error PaymentExceedsCap(uint256 requested, uint256 cap);
    error NotOwner(address caller);

    event Deposited(address indexed depositor, address indexed token, uint256 amount);
    event CallbackPayment(address indexed caller, address indexed token, uint256 amount);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    IERC20 public immutable token0;
    IERC20 public immutable token1;
    uint256 public immutable maxCallbackPayment;
    address public owner;

    modifier onlyOwner() {
        if (msg.sender != owner) {
            revert NotOwner(msg.sender);
        }
        _;
    }

    /// @param token0_ First ERC-20; the Sepolia deployment uses Circle test USDC.
    /// @param token1_ Second ERC-20; the Sepolia deployment uses Circle test EURC.
    /// @param maxCallbackPayment_ Maximum raw amount paid per positive token delta.
    constructor(IERC20 token0_, IERC20 token1_, uint256 maxCallbackPayment_) {
        if (address(token0_) == address(0) || address(token1_) == address(0)) {
            revert ZeroAddress();
        }
        if (maxCallbackPayment_ == 0) {
            revert InvalidMaxCallbackPayment();
        }

        token0 = token0_;
        token1 = token1_;
        maxCallbackPayment = maxCallbackPayment_;
        owner = msg.sender;

        emit OwnershipTransferred(address(0), owner);
    }

    /// @notice Transfers ownership to a new owner; only the current owner may call this function.
    /// @dev Rejects the zero address as an ownership recipient.
    /// @param newOwner The non-zero address to receive ownership.
    function transferOwner(address newOwner) external onlyOwner {
        if (newOwner == address(0)) {
            revert ZeroAddress();
        }

        address previousOwner = owner;
        owner = newOwner;
        emit OwnershipTransferred(previousOwner, newOwner);
    }

    /// @notice Deposits one of the two configured tokens into the trader.
    /// @param token Address of token0 or token1.
    /// @param amount Amount in raw token units.
    function deposit(address token, uint256 amount) external {
        if (token != address(token0) && token != address(token1)) {
            revert UnsupportedDepositToken(token);
        }

        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        emit Deposited(msg.sender, token, amount);
    }

    /// @notice Pays positive deltas directly to any caller.
    /// @dev This function is intentionally unsafe and must never be reused in production.
    /// @param amount0Delta Positive raw token0 amount to pay.
    /// @param amount1Delta Positive raw token1 amount to pay.
    /// @param data Unused callback data.
    function uniswapV3SwapCallback(int256 amount0Delta, int256 amount1Delta, bytes calldata data) external override {
        data;
        if (amount0Delta <= 0 && amount1Delta <= 0) {
            revert InvalidDeltas();
        }

        // INTENTIONAL VULNERABILITY:
        // msg.sender is not verified as a legitimate Uniswap V3 pool.
        if (amount0Delta > 0) {
            _pay(token0, uint256(amount0Delta));
        }
        if (amount1Delta > 0) {
            _pay(token1, uint256(amount1Delta));
        }
    }

    function _pay(IERC20 token, uint256 amount) private {
        if (amount > maxCallbackPayment) {
            revert PaymentExceedsCap(amount, maxCallbackPayment);
        }

        token.safeTransfer(msg.sender, amount);
        emit CallbackPayment(msg.sender, address(token), amount);
    }
}
