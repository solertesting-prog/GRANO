# GRANO · contratos

Token de utilidad del ecosistema de café y cacao trazables, en Polygon.

## Contratos

| Contrato | Qué hace |
|---|---|
| `GranoToken` | ERC-20 "Grano" (GRANO). 100.000.000 de suministro **fijo**, sin función de emisión ni administrador. Quemable (canje por producto) y con `permit` (EIP-2612). |
| `GranoSale` | Venta pública a precio fijo de 0,05 USDC. Tope de 15M GRANO (750.000 USDC), mínimo 1.000 GRANO y máximo 200.000 GRANO por wallet, lista KYC activable, pausa, pago directo a tesorería y devolución de lo no vendido al cierre. |
| `GranoVesting` | Bóveda de liberación gradual (VestingWallet de OpenZeppelin) para equipo, asesores, tesorería, productores y ecosistema. |
| `mocks/MockUSDC` | Stablecoin de pruebas. Solo testnet y local. |

## Tokenomics

| Partida | % | GRANO | Liberación |
|---|---|---|---|
| Venta pública | 15 % | 15.000.000 | Inmediata |
| Ecosistema y recompensas | 25 % | 25.000.000 | Lineal 48 meses |
| Productores y cooperativas | 15 % | 15.000.000 | Lineal 36 meses |
| Tesorería | 15 % | 15.000.000 | Bloqueo 6 meses + lineal 24 |
| Equipo | 15 % | 15.000.000 | Bloqueo 12 meses + lineal 36 |
| Liquidez | 10 % | 10.000.000 | Al listar |
| Asesores y socios | 5 % | 5.000.000 | Bloqueo 6 meses + lineal 24 |

## Uso

```bash
npm install
npx hardhat test                 # tests
cp .env.example .env             # rellena PRIVATE_KEY (wallet de pruebas)
npm run deploy:amoy              # despliegue en testnet Polygon Amoy
```

Necesitas POL de prueba en Amoy (faucet oficial de Polygon). El script imprime las direcciones para pegarlas en la configuración de la web (`CONFIG` al principio de `web/index.html`).

## Abrir el mercado (DEX)

El precio de 0,05 USDC solo rige en la venta. Al cerrarla, `scripts/add-liquidity.js` crea el pool GRANO/USDC en QuickSwap V2 y, desde ahí, el precio lo marca el mercado.

- **Precio de apertura** = USDC depositados ÷ GRANO depositados. Por defecto: 2.000.000 GRANO + 100.000 USDC = 0,05.
- **Cuanta más liquidez, menos se mueve el precio** con cada compra o venta. El resto de la partida de liquidez (8M) queda para ampliar el pool o para exchanges centralizados.
- Se detiene si la venta sigue activa o si alguien ya creó el par con otro precio.
- Con `SAFE_MODE=1` (recomendado) no envía nada: genera un JSON para importarlo en el **Transaction Builder** de Safe y firmarlo con la multisig de tesorería, que es quien tiene los fondos.
- Después, bloquea los tokens LP en un servicio de bloqueo público: es lo primero que miran los compradores.

```bash
npm run liquidity:polygon      # mainnet (router de QuickSwap V2 por defecto: verifícalo)
ROUTER_ADDRESS=0x... npm run liquidity:amoy   # testnet: necesitas un router V2 desplegado en Amoy
```

## Antes de mainnet

1. Auditoría externa de los contratos.
2. Propiedad de `GranoSale` y tesorería en una multisig (Safe): `transferOwnership` + `acceptOwnership`.
3. `USDC_ADDRESS` = USDC nativo de Polygon (verifica la dirección en la web oficial de Circle).
4. Revisión legal MiCA (white paper o exención, comunicaciones comerciales, países excluidos).
5. Verificar el código en Polygonscan: `npx hardhat verify --network polygon <dirección> <args>`.
