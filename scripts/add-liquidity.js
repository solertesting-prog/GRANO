/**
 * Abre el primer mercado de GRANO: crea el pool GRANO/USDC en un DEX tipo Uniswap V2
 * (QuickSwap V2 en Polygon) con el precio de apertura que elijas.
 *
 *   precio de apertura = USDC depositados / GRANO depositados
 *
 * Variables de entorno (.env):
 *   GRANO_ADDRESS      dirección del token (salida de deploy.js)
 *   USDC_ADDRESS       stablecoin del par
 *   SALE_ADDRESS       (opcional) contrato de venta; si está activa, el script se detiene
 *   ROUTER_ADDRESS     router Uniswap V2 del DEX. Obligatorio fuera de mainnet
 *   LP_GRANO           GRANO a depositar (por defecto 2.000.000)
 *   OPEN_PRICE         precio de apertura en USDC (por defecto 0.05)
 *   LP_RECIPIENT       quién recibe los tokens LP (por defecto la tesorería / desplegador)
 *   SAFE_MODE=1        no envía nada: genera un JSON para importar en el Transaction Builder
 *                      de Safe, para ejecutarlo desde la multisig de tesorería (recomendado)
 *   FORCE=1            continuar aunque la venta siga activa
 *
 * Uso:
 *   npx hardhat run scripts/add-liquidity.js --network polygon
 */
const fs = require("fs");
const path = require("path");
const { ethers, network } = require("hardhat");

// QuickSwap V2 Router en Polygon PoS. Verifica siempre esta dirección en la documentación
// oficial de QuickSwap antes de usarla en mainnet.
const DEFAULT_ROUTERS = { polygon: "0xa5E0829CaCEd8fFDD4De3c43696c57F7D7A678ff" };

const ROUTER_ABI = [
  "function factory() view returns (address)",
  "function addLiquidity(address tokenA,address tokenB,uint amountADesired,uint amountBDesired,uint amountAMin,uint amountBMin,address to,uint deadline) returns (uint amountA,uint amountB,uint liquidity)",
];
const FACTORY_ABI = ["function getPair(address,address) view returns (address)"];
const PAIR_ABI = ["function getReserves() view returns (uint112,uint112,uint32)"];
const ERC20_ABI = [
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
];
const SALE_ABI = ["function isActive() view returns (bool)"];

async function main() {
  const env = process.env;
  const [signer] = await ethers.getSigners();
  const need = (k) => {
    if (!env[k]) throw new Error(`Falta ${k} en .env`);
    return env[k];
  };

  const granoAddr = need("GRANO_ADDRESS");
  const usdcAddr = need("USDC_ADDRESS");
  const routerAddr = env.ROUTER_ADDRESS || DEFAULT_ROUTERS[network.name];
  if (!routerAddr) throw new Error(`Define ROUTER_ADDRESS para la red ${network.name}`);

  const safeMode = env.SAFE_MODE === "1";
  const lpRecipient = env.LP_RECIPIENT || env.TREASURY_ADDRESS || signer.address;
  const from = safeMode ? lpRecipient : signer.address; // en modo Safe, quien firma es la multisig

  const grano = new ethers.Contract(granoAddr, ERC20_ABI, signer);
  const usdc = new ethers.Contract(usdcAddr, ERC20_ABI, signer);
  const router = new ethers.Contract(routerAddr, ROUTER_ABI, signer);
  const usdcDec = Number(await usdc.decimals());

  // Cantidades y precio
  const granoHuman = env.LP_GRANO || "2000000";
  const priceHuman = env.OPEN_PRICE || "0.05";
  const granoAmount = ethers.parseUnits(granoHuman, 18);
  const priceUnits = ethers.parseUnits(priceHuman, usdcDec); // USDC por 1 GRANO
  const usdcAmount = (granoAmount * priceUnits) / 10n ** 18n;
  if (usdcAmount === 0n) throw new Error("El importe en USDC sale cero: revisa LP_GRANO y OPEN_PRICE");

  console.log(`Red: ${network.name}`);
  console.log(`Pool: ${granoHuman} GRANO + ${ethers.formatUnits(usdcAmount, usdcDec)} USDC`);
  console.log(`Precio de apertura: ${priceHuman} USDC por GRANO`);
  console.log(`Tokens LP para: ${lpRecipient}`);

  // 1. La venta debe haber terminado (todos los compradores pagan el mismo precio)
  if (env.SALE_ADDRESS && env.FORCE !== "1") {
    const sale = new ethers.Contract(env.SALE_ADDRESS, SALE_ABI, signer);
    if (await sale.isActive()) throw new Error("La venta sigue activa. Ciérrala antes o usa FORCE=1.");
  }

  // 2. Protección contra un precio de apertura manipulado: si alguien ya creó el par
  //    y le metió liquidez, añadir la nuestra aceptaría su precio. En ese caso paramos.
  const factory = new ethers.Contract(await router.factory(), FACTORY_ABI, signer);
  const pairAddr = await factory.getPair(granoAddr, usdcAddr);
  if (pairAddr !== ethers.ZeroAddress) {
    const [r0, r1] = await new ethers.Contract(pairAddr, PAIR_ABI, signer).getReserves();
    if (r0 > 0n || r1 > 0n) {
      throw new Error(
        `El par ya existe con liquidez (${pairAddr}). No se añade para no aceptar un precio ajeno. Revísalo manualmente.`
      );
    }
    console.log(`El par existe pero está vacío: ${pairAddr}`);
  }

  // 3. Saldos
  const [balG, balU] = await Promise.all([grano.balanceOf(from), usdc.balanceOf(from)]);
  if (balG < granoAmount) throw new Error(`${from} solo tiene ${ethers.formatUnits(balG, 18)} GRANO`);
  if (balU < usdcAmount) throw new Error(`${from} solo tiene ${ethers.formatUnits(balU, usdcDec)} USDC`);

  // Par nuevo: las cantidades entran exactas, así que los mínimos son las propias cantidades
  const deadline = Math.floor(Date.now() / 1000) + (safeMode ? 7 * 24 * 3600 : 20 * 60);
  const addArgs = [granoAddr, usdcAddr, granoAmount, usdcAmount, granoAmount, usdcAmount, lpRecipient, deadline];

  if (safeMode) {
    const tx = (to, data) => ({ to, value: "0", data, contractMethod: null, contractInputsValues: null });
    const batch = {
      version: "1.0",
      chainId: String(network.config.chainId),
      createdAt: Date.now(),
      meta: { name: "GRANO · abrir pool de liquidez", description: `Precio de apertura ${priceHuman} USDC` },
      transactions: [
        tx(granoAddr, grano.interface.encodeFunctionData("approve", [routerAddr, granoAmount])),
        tx(usdcAddr, usdc.interface.encodeFunctionData("approve", [routerAddr, usdcAmount])),
        tx(routerAddr, router.interface.encodeFunctionData("addLiquidity", addArgs)),
      ],
    };
    const out = path.join(__dirname, "..", `safe-add-liquidity-${network.name}.json`);
    fs.writeFileSync(out, JSON.stringify(batch, null, 2));
    console.log(`\nLote para Safe guardado en ${out}`);
    console.log("Impórtalo en Safe > Transaction Builder, revisa y firma con la multisig. Caduca en 7 días.");
    return;
  }

  // 4. Aprobaciones y alta de liquidez desde la wallet del script
  if ((await grano.allowance(from, routerAddr)) < granoAmount) {
    await (await grano.approve(routerAddr, granoAmount)).wait();
    console.log("GRANO aprobado");
  }
  if ((await usdc.allowance(from, routerAddr)) < usdcAmount) {
    await (await usdc.approve(routerAddr, usdcAmount)).wait();
    console.log("USDC aprobado");
  }
  const receipt = await (await router.addLiquidity(...addArgs)).wait();
  const newPair = await factory.getPair(granoAddr, usdcAddr);
  console.log(`\nPool creado: ${newPair}`);
  console.log(`Transacción: ${receipt.hash}`);
  console.log("Siguiente paso: bloquea los tokens LP en un servicio de bloqueo público para dar confianza.");
}

main().catch((e) => {
  console.error(e.message || e);
  process.exitCode = 1;
});
