// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/**
 * @title GranoSale
 * @notice Venta pública de GRANO a precio fijo, pagada en una stablecoin (p. ej. USDC).
 *
 *  - Precio fijo durante toda la venta (sin rondas con descuento).
 *  - Tope total (hard cap) y límites mínimo / máximo por wallet.
 *  - Lista de direcciones verificadas (KYC) activable.
 *  - El pago va directamente a la tesorería: el contrato nunca custodia stablecoins.
 *  - Entrega inmediata de los tokens.
 *  - Al terminar, los tokens no vendidos vuelven a la tesorería.
 */
contract GranoSale is Ownable2Step, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable grano;
    IERC20 public immutable paymentToken;
    address public immutable treasury;

    /// @notice Precio de 1 GRANO completo (1e18 unidades) expresado en unidades mínimas
    ///         de la stablecoin. Con USDC (6 decimales) y 0,05 USDC => 50_000.
    uint256 public immutable price;

    uint256 public immutable saleCap; // GRANO a la venta (18 decimales)
    uint64 public immutable startTime;
    uint64 public immutable endTime;
    uint256 public immutable minPurchase; // GRANO mínimos por compra
    uint256 public immutable maxPerWallet; // GRANO máximos acumulados por wallet

    uint256 public totalSold;
    mapping(address => uint256) public purchased;

    bool public allowlistEnabled;
    mapping(address => bool) public allowlisted;

    event Purchased(address indexed buyer, uint256 granoAmount, uint256 cost);
    event AllowlistUpdated(address indexed account, bool allowed);
    event AllowlistEnabled(bool enabled);
    event UnsoldWithdrawn(uint256 amount);

    error SaleNotActive();
    error SaleNotEnded();
    error NotAllowlisted();
    error BelowMinimum();
    error WalletLimitExceeded();
    error CapExceeded();
    error ZeroCost();
    error InvalidConfig();

    struct Config {
        address grano;
        address paymentToken;
        address treasury;
        uint256 price;
        uint256 saleCap;
        uint64 startTime;
        uint64 endTime;
        uint256 minPurchase;
        uint256 maxPerWallet;
        bool allowlistEnabled;
    }

    constructor(Config memory c, address owner_) Ownable(owner_) {
        if (
            c.grano == address(0) || c.paymentToken == address(0) || c.treasury == address(0) || c.price == 0
                || c.saleCap == 0 || c.endTime <= c.startTime || c.minPurchase > c.maxPerWallet
                || c.maxPerWallet > c.saleCap
        ) revert InvalidConfig();

        grano = IERC20(c.grano);
        paymentToken = IERC20(c.paymentToken);
        treasury = c.treasury;
        price = c.price;
        saleCap = c.saleCap;
        startTime = c.startTime;
        endTime = c.endTime;
        minPurchase = c.minPurchase;
        maxPerWallet = c.maxPerWallet;
        allowlistEnabled = c.allowlistEnabled;
    }

    // ------------------------------------------------------------------ compra

    /// @notice Coste en stablecoin de `granoAmount` (redondeado hacia arriba).
    function quote(uint256 granoAmount) public view returns (uint256) {
        return Math.mulDiv(granoAmount, price, 1e18, Math.Rounding.Ceil);
    }

    function isActive() public view returns (bool) {
        return !paused() && block.timestamp >= startTime && block.timestamp < endTime && totalSold < saleCap;
    }

    function remaining() external view returns (uint256) {
        return saleCap - totalSold;
    }

    /**
     * @notice Compra `granoAmount` GRANO (18 decimales). Antes hay que aprobar
     *         `quote(granoAmount)` de la stablecoin a este contrato.
     */
    function buy(uint256 granoAmount) external nonReentrant whenNotPaused {
        if (block.timestamp < startTime || block.timestamp >= endTime) revert SaleNotActive();
        if (allowlistEnabled && !allowlisted[msg.sender]) revert NotAllowlisted();
        if (granoAmount < minPurchase) revert BelowMinimum();
        if (purchased[msg.sender] + granoAmount > maxPerWallet) revert WalletLimitExceeded();
        if (totalSold + granoAmount > saleCap) revert CapExceeded();

        uint256 cost = quote(granoAmount);
        if (cost == 0) revert ZeroCost();

        purchased[msg.sender] += granoAmount;
        totalSold += granoAmount;

        paymentToken.safeTransferFrom(msg.sender, treasury, cost);
        grano.safeTransfer(msg.sender, granoAmount);

        emit Purchased(msg.sender, granoAmount, cost);
    }

    // ------------------------------------------------------------ administración

    function setAllowlist(address[] calldata accounts, bool allowed) external onlyOwner {
        for (uint256 i; i < accounts.length; ++i) {
            allowlisted[accounts[i]] = allowed;
            emit AllowlistUpdated(accounts[i], allowed);
        }
    }

    function setAllowlistEnabled(bool enabled) external onlyOwner {
        allowlistEnabled = enabled;
        emit AllowlistEnabled(enabled);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    /// @notice Devuelve a la tesorería los GRANO no vendidos, solo cuando la venta ha terminado
    ///         (por fecha o por agotar el tope).
    function withdrawUnsold() external onlyOwner {
        if (block.timestamp < endTime && totalSold < saleCap) revert SaleNotEnded();
        uint256 balance = grano.balanceOf(address(this));
        grano.safeTransfer(treasury, balance);
        emit UnsoldWithdrawn(balance);
    }
}
