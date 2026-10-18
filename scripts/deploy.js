/**
 * Despliegue completo de GRANO:
 *  1. Token con 100M de suministro fijo.
 *  2. Contrato de venta pública (15M a 0,05 USDC).
 *  3. Bóvedas de vesting para cada partida de la tokenomics.
 *  4. Reparto de los tokens según la tokenomics.
 *
 * Variables de entorno (.env):
 *   PRIVATE_KEY          clave del desplegador (en mainnet: usar después una multisig)
 *   USDC_ADDRESS         stablecoin de pago. Si falta, se despliega un MockUSDC (solo testnet/local)
 *   TREASURY_ADDRESS     multisig de tesorería (recibe los pagos). Por defecto, el desplegador
 *   TEAM_ADDRESS, ADVISORS_ADDRESS, PRODUCERS_ADDRESS, ECOSYSTEM_ADDRESS   beneficiarios de vesting
 *   SALE_START           timestamp unix de inicio (por defecto: dentro de 10 minutos)
 *   SALE_DAYS            duración en días (por defecto: 30)
 *   ALLOWLIST            wallets autorizadas a comprar, separadas por comas (pruebas)
 *   NEW_OWNER            wallet que pasará a administrar la venta (traspaso en 2 pasos)
 */
const fs = require("fs");
const path = require("path");
const { ethers, network } = require("hardhat");

const G = (n) => ethers.parseUnits(String(n), 18);
const MONTH = 30 * 24 * 3600;

async function main() {
  const [deployer] = await ethers.getSigners();
  const env = process.env;
  const treasury = env.TREASURY_ADDRESS || deployer.address;
  const now = Math.floor(Date.now() / 1000);

  console.log(`Red: ${network.name} | Desplegador: ${deployer.address}`);

  // 1. Token: todo el suministro va al desplegador para repartirlo en este script
  const token = await ethers.deployContract("GranoToken", [deployer.address]);
  await token.waitForDeployment();
  const tokenAddr = await token.getAddress();
  console.log("GranoToken:", tokenAddr);

  // Stablecoin de pago
  let usdcAddr = env.USDC_ADDRESS;
  if (!usdcAddr) {
    if (network.name === "polygon") throw new Error("En mainnet define USDC_ADDRESS");
    const mock = await ethers.deployContract("MockUSDC");
    await mock.waitForDeployment();
    usdcAddr = await mock.getAddress();
    console.log("MockUSDC (pruebas):", usdcAddr);
  }

  // 2. Venta pública
  const start = Number(env.SALE_START || now + 600);
  const days = Number(env.SALE_DAYS || 30);
  const saleCfg = {
    grano: tokenAddr,
    paymentToken: usdcAddr,
    treasury,
    price: 50_000n, // 0,05 USDC (6 decimales)
    saleCap: G(15_000_000),
    startTime: start,
    endTime: start + days * 24 * 3600,
    minPurchase: G(1_000), // 50 USDC
    maxPerWallet: G(200_000), // 10.000 USDC
    allowlistEnabled: true, // KYC obligatorio por defecto
  };
  const sale = await ethers.deployContract("GranoSale", [saleCfg, deployer.address]);
  await sale.waitForDeployment();
  const saleAddr = await sale.getAddress();
  console.log("GranoSale:", saleAddr);

  // 3. Bóvedas de vesting: [nombre, beneficiario, tokens, bloqueo (meses), liberación lineal (meses)]
  const plan = [
    ["Equipo", env.TEAM_ADDRESS, 15_000_000, 12, 36],
    ["Asesores y socios", env.ADVISORS_ADDRESS, 5_000_000, 6, 24],
    ["Tesorería", treasury, 15_000_000, 6, 24],
    ["Productores y cooperativas", env.PRODUCERS_ADDRESS, 15_000_000, 0, 36],
    ["Ecosistema y recompensas", env.ECOSYSTEM_ADDRESS, 25_000_000, 0, 48],
  ];

  const deployed = { GranoToken: tokenAddr, PaymentToken: usdcAddr, GranoSale: saleAddr, vesting: {} };

  // 4. Reparto
  await (await token.transfer(saleAddr, saleCfg.saleCap)).wait();
  for (const [name, who, amount, lock, linear] of plan) {
    const beneficiary = who || deployer.address;
    const v = await ethers.deployContract("GranoVesting", [beneficiary, now + lock * MONTH, linear * MONTH]);
    await v.waitForDeployment();
    const addr = await v.getAddress();
    await (await token.transfer(addr, G(amount))).wait();
    deployed.vesting[name] = addr;
    console.log(`Vesting ${name}: ${addr} (${amount.toLocaleString("es-ES")} GRANO)`);
  }

  // Liquidez (10M): se queda en la tesorería para crear el pool cuando se liste
  await (await token.transfer(treasury, G(10_000_000))).wait();

  // Compradores de prueba autorizados (lista KYC), separados por comas
  const allow = (env.ALLOWLIST || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (allow.length) {
    for (const a of allow) if (!ethers.isAddress(a)) throw new Error(`Dirección no válida en ALLOWLIST: ${a}`);
    await (await sale.setAllowlist(allow, true)).wait();
    console.log(`Autorizadas para comprar: ${allow.join(", ")}`);
  }

  // Traspaso de la administración de la venta (2 pasos: el nuevo dueño debe aceptar
  // llamando a acceptOwnership() desde su wallet).
  if (env.NEW_OWNER && env.NEW_OWNER.toLowerCase() !== deployer.address.toLowerCase()) {
    if (!ethers.isAddress(env.NEW_OWNER)) throw new Error("NEW_OWNER no es una dirección válida");
    await (await sale.transferOwnership(env.NEW_OWNER)).wait();
    console.log(`Administración de la venta propuesta a ${env.NEW_OWNER} (pendiente de aceptar)`);
    deployed.pendingOwner = env.NEW_OWNER;
  }

  const left = await token.balanceOf(deployer.address);
  console.log("Saldo restante del desplegador:", ethers.formatUnits(left, 18));

  deployed.network = network.name;
  deployed.chainId = Number(network.config.chainId || 31337);
  deployed.saleStart = new Date(saleCfg.startTime * 1000).toISOString();
  deployed.saleEnd = new Date(saleCfg.endTime * 1000).toISOString();
  deployed.mockUSDC = !env.USDC_ADDRESS;
  const dir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${network.name}.json`), JSON.stringify(deployed, null, 2));
  console.log(`\nDirecciones guardadas en deployments/${network.name}.json:\n`, JSON.stringify(deployed, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
