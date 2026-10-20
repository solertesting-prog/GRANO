// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {GranoToken} from "./GranoToken.sol";
import {GranoVesting} from "./GranoVesting.sol";

/**
 * @title GranoLauncher
 * @notice Despliega GRANO completo en UNA sola transacción: el token, las cinco bóvedas de
 *         vesting y el reparto. O se crea todo o no se crea nada.
 *
 * Al terminar, el lanzador no conserva tokens ni permisos: solo guarda las direcciones
 * creadas para que cualquiera pueda consultarlas.
 */
contract GranoLauncher {
    uint256 private constant MONTH = 30 days;
    uint256 private constant UNIT = 1e18;

    GranoToken public immutable token;
    address public immutable treasury;
    address public immutable ecosystemVault;
    address public immutable producersVault;
    address public immutable treasuryVault;
    address public immutable teamVault;
    address public immutable advisorsVault;

    event Launched(
        address token,
        address treasury,
        address ecosystemVault,
        address producersVault,
        address treasuryVault,
        address teamVault,
        address advisorsVault
    );

    /**
     * @param treasury_   multisig de tesorería: recibe venta (15M) + liquidez (10M) y es
     *                    beneficiaria de la bóveda de tesorería.
     * @param ecosystem   beneficiario de la bóveda de ecosistema (25M, lineal 48 meses)
     * @param producers   beneficiario de la bóveda de productores (15M, lineal 36 meses)
     * @param team        beneficiario de la bóveda del equipo (15M, 12 meses + 36 lineal)
     * @param advisors    beneficiario de la bóveda de asesores (5M, 6 meses + 24 lineal)
     */
    constructor(address treasury_, address ecosystem, address producers, address team, address advisors) {
        require(
            treasury_ != address(0) && ecosystem != address(0) && producers != address(0) && team != address(0)
                && advisors != address(0),
            "GRANO: direccion cero"
        );
        treasury = treasury_;

        GranoToken t = new GranoToken(address(this));
        token = t;
        uint64 start = uint64(block.timestamp);

        address eco = _vault(t, ecosystem, start, 0, 48, 25_000_000);
        address prod = _vault(t, producers, start, 0, 36, 15_000_000);
        address trv = _vault(t, treasury_, start, 6, 24, 15_000_000);
        address tv = _vault(t, team, start, 12, 36, 15_000_000);
        address av = _vault(t, advisors, start, 6, 24, 5_000_000);
        ecosystemVault = eco;
        producersVault = prod;
        treasuryVault = trv;
        teamVault = tv;
        advisorsVault = av;

        // Venta pública (15M) + liquidez (10M) a la tesorería
        require(t.transfer(treasury_, 25_000_000 * UNIT), "GRANO: transferencia");
        require(t.balanceOf(address(this)) == 0, "GRANO: saldo restante");

        emit Launched(address(t), treasury_, eco, prod, trv, tv, av);
    }

    function _vault(GranoToken t, address beneficiary, uint64 start, uint256 lockMonths, uint256 months, uint256 amount)
        private
        returns (address)
    {
        GranoVesting v =
            new GranoVesting(beneficiary, uint64(start + lockMonths * MONTH), uint64(months * MONTH));
        require(t.transfer(address(v), amount * UNIT), "GRANO: transferencia");
        return address(v);
    }
}
