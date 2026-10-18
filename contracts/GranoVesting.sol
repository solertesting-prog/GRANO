// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {VestingWallet} from "@openzeppelin/contracts/finance/VestingWallet.sol";

/**
 * @notice Bóveda de liberación gradual (vesting) estándar de OpenZeppelin.
 *         No libera nada antes de `start`; después libera de forma lineal durante `duration`.
 *         Ejemplo equipo: start = despliegue + 12 meses, duration = 36 meses.
 */
contract GranoVesting is VestingWallet {
    constructor(address beneficiary, uint64 start, uint64 duration) VestingWallet(beneficiary, start, duration) {}
}
