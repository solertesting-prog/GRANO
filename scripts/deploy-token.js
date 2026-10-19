/**
 * Despliegue DEFINITIVO del token GRANO (sin contrato de venta).
 *
 *  1. GranoToken: 100.000.000 GRANO de suministro fijo.
 *  2. Una bóveda de vesting por partida, a nombre de la tesorería (multisig Safe).
 *  3. Venta pública (15M) y liquidez (10M) a la tesorería: la venta se desplegará
 *     más adelante con scripts/deploy-sale.js, cuando la parte legal esté lista.
 *  4. Comprobaciones finales: el desplegador termina con 0 GRANO y todo cuadra.
 *
 * Variables de entorno:
 *   PRIVATE_KEY        clave del desplegador (puede ser temporal: no conserva ningún permiso)
 *   TREASURY_ADDRESS   multisig Safe de tesorería. En Polygon mainnet debe ser un contrato.
 *   Beneficiarios opcionales (por defecto, la tesorería):
 *   TEAM_ADDRESS, ADVISORS_ADDRESS, PRODUCERS_ADDRESS, ECOSYSTEM_ADDRESS
 */
const fs = require("fs");
const path = require("path");
const { ethers, network } = require("hardhat");

const G = (n) => ethers.parseUnits(String(n), 18);
const MONTH = 30 * 24 * 3600;

function fail(msg) {
  console.log(`::error title=Despliegue::${msg}`);
  throw new Error(msg);
}

async function main() {
  const env = process.env;
  const [deployer] = await ethers.getSigners();
  const treasury = env.TREASURY_ADDRESS;
  if (!treasury || !ethers.isAddress(treasury)) fail("TREASURY_ADDRESS no es una dirección válida");

  // La tesorería debe ser una multisig (un contrato), no una wallet normal
  const code = await ethers.provider.getCode(treasury);
  if (network.name === "polygon" && code === "0x") {
    fail(`${treasury} no es un contrato: crea primero la Safe en Polygon y usa su dirección`);
  }

  const who = (v) => (v && ethers.isAddress(v) ? v : treasury);
  const now = Math.floor(Date.now() / 1000);
  console.log(`Red: ${network.name} | Desplegador: ${deployer.address} | Tesorería: ${treasury}`);

  // 1. Token
  const token = await ethers.deployContract("GranoToken", [deployer.address]);
  await token.waitForDeployment();
  const tokenAddr = await token.getAddress();
  console.log("GranoToken:", tokenAddr);

  // 2. Bóvedas: [partida, beneficiario, GRANO, bloqueo (meses), liberación lineal (meses)]
  const plan = [
    ["Ecosistema y recompensas", who(env.ECOSYSTEM_ADDRESS), 25_000_000, 0, 48],
    ["Productores y cooperativas", who(env.PRODUCERS_ADDRESS), 15_000_000, 0, 36],
    ["Tesorería", treasury, 15_000_000, 6, 24],
    ["Equipo", who(env.TEAM_ADDRESS), 15_000_000, 12, 36],
    ["Asesores y socios", who(env.ADVISORS_ADDRESS), 5_000_000, 6, 24],
  ];
  const deployed = {
    network: network.name,
    chainId: Number(network.config.chainId),
    deployedAt: new Date().toISOString(),
    GranoToken: tokenAddr,
    treasury,
    vesting: {},
    heldByTreasury: { "Venta pública (pendiente de contrato)": 15_000_000, Liquidez: 10_000_000 },
  };

  for (const [name, beneficiary, amount, lock, linear] of plan) {
    const start = now + lock * MONTH;
    const v = await ethers.deployContract("GranoVesting", [beneficiary, start, linear * MONTH]);
    await v.waitForDeployment();
    const addr = await v.getAddress();
    await (await token.transfer(addr, G(amount))).wait();
    deployed.vesting[name] = {
      address: addr,
      beneficiary,
      amount,
      start: new Date(start * 1000).toISOString(),
      months: linear,
    };
    console.log(`Vesting ${name}: ${addr} (${amount.toLocaleString("es-ES")} GRANO)`);
  }

  // 3. Venta (15M) + liquidez (10M) a la tesorería
  await (await token.transfer(treasury, G(25_000_000))).wait();
  console.log("25.000.000 GRANO (venta + liquidez) a la tesorería");

  // 4. Comprobaciones
  const left = await token.balanceOf(deployer.address);
  if (left !== 0n) fail(`El desplegador conserva ${ethers.formatUnits(left, 18)} GRANO`);
  let sum = await token.balanceOf(treasury);
  for (const v of Object.values(deployed.vesting)) sum += await token.balanceOf(v.address);
  if (sum !== G(100_000_000)) fail(`Los saldos no suman 100M: ${ethers.formatUnits(sum, 18)}`);
  console.log("Comprobado: 100.000.000 GRANO repartidos y 0 en el desplegador");

  const dir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${network.name}.json`), JSON.stringify(deployed, null, 2));
  console.log(`::notice title=GRANO desplegado::${JSON.stringify(deployed)}`);
}

main().catch((e) => {
  console.log(`::error title=Despliegue::${(e.shortMessage || e.message || String(e)).split("\n")[0]}`);
  process.exitCode = 1;
});
