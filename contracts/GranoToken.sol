// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";

/**
 * @title GRANO
 * @notice Token de utilidad del ecosistema de café y cacao trazables.
 *
 * Diseño deliberadamente simple para generar confianza:
 *  - Suministro FIJO: los 100.000.000 GRANO se crean una sola vez en el despliegue.
 *    No existe ninguna función para emitir más tokens.
 *  - Sin propietario ni funciones de administración: nadie puede congelar,
 *    confiscar ni modificar saldos.
 *  - Quemable: cuando un usuario canjea GRANO por producto físico, los tokens
 *    se destruyen (burn / burnFrom), de modo que la oferta se reduce con el consumo real.
 *  - Permit (EIP-2612): permite aprobar gastos con una firma, sin pagar gas extra.
 */
contract GranoToken is ERC20, ERC20Burnable, ERC20Permit {
    /// @notice Suministro total máximo: 100 millones con 18 decimales.
    uint256 public constant MAX_SUPPLY = 100_000_000 * 1e18;

    /**
     * @param distributor Dirección que recibe el suministro completo para repartirlo
     *        según la tokenomics (se recomienda una multisig tipo Safe).
     */
    constructor(address distributor) ERC20("Grano", "GRANO") ERC20Permit("Grano") {
        require(distributor != address(0), "GRANO: distributor cero");
        _mint(distributor, MAX_SUPPLY);
    }
}
