/**
 * Despliegue DEFINITIVO de GRANO en UNA sola transacción (contrato GranoLauncher):
 * token de 100M, cinco bóvedas de vesting y el reparto. O se crea todo o nada.
 * La venta se despliega más adelante, cuando la parte legal esté lista.
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

function fail(msg) {
  throw new Error(msg);
}

async function main() {
  const env = process.env;
  const [deployer] = await ethers.getSigners();
  const treasury = env.TREASURY_ADDRESS;
  if (!treasury || !ethers.isAddress(treasury)) fail("TREASURY_ADDRESS no es una dirección válida");
  if (network.name === "polygon" && (await ethers.provider.getCode(treasury)) === "0x") {
    fail(`${treasury} no es un contrato: crea primero la Safe en Polygon y usa su dirección`);
  }
  const who = (v) => (v && ethers.isAddress(v) ? v : treasury);
  const args = [treasury, who(env.ECOSYSTEM_ADDRESS), who(env.PRODUCERS_ADDRESS), who(env.TEAM_ADDRESS), who(env.ADVISORS_ADDRESS)];

  console.log(`Red: ${network.name} | Desplegador: ${deployer.address} | Tesorería: ${treasury}`);

  // Estimación previa: si no hay saldo suficiente, no se envía nada
  const Launcher = await ethers.getContractFactory("GranoLauncher");
  const txReq = await Launcher.getDeployTransaction(...args);
  const gas = await ethers.provider.estimateGas({ ...txReq, from: deployer.address });
  const gasLimit = (gas * 125n) / 100n;
  const fee = await ethers.provider.getFeeData();
  const price = fee.gasPrice || fee.maxFeePerGas;
  const bal = await ethers.provider.getBalance(deployer.address);
  console.log(`Gas estimado: ${gas} | coste máximo: ${ethers.formatEther(gasLimit * price)} POL | saldo: ${ethers.formatEther(bal)} POL`);
  if (bal < gasLimit * price) fail(`Saldo insuficiente: hacen falta ${ethers.formatEther(gasLimit * price)} POL`);

  // UNA transacción
  const launcher = await Launcher.deploy(...args, { gasLimit });
  const receipt = await launcher.deploymentTransaction().wait();
  if (receipt.status !== 1) fail(`La transacción ${receipt.hash} se revirtió: no se ha creado nada`);
  const launcherAddr = await launcher.getAddress();
  console.log(`Lanzador: ${launcherAddr} | tx ${receipt.hash} | gas usado ${receipt.gasUsed}`);

  const token = await ethers.getContractAt("GranoToken", await launcher.token());
  const vaults = {
    "Ecosistema y recompensas": [await launcher.ecosystemVault(), 25_000_000, args[1]],
    "Productores y cooperativas": [await launcher.producersVault(), 15_000_000, args[2]],
    Tesorería: [await launcher.treasuryVault(), 15_000_000, treasury],
    Equipo: [await launcher.teamVault(), 15_000_000, args[3]],
    "Asesores y socios": [await launcher.advisorsVault(), 5_000_000, args[4]],
  };

  // Comprobaciones
  if ((await token.totalSupply()) !== G(100_000_000)) fail("El suministro no es 100M");
  if ((await token.balanceOf(treasury)) !== G(25_000_000)) fail("La tesorería no tiene 25M");
  for (const [name, [addr, amount]] of Object.entries(vaults)) {
    if ((await token.balanceOf(addr)) !== G(amount)) fail(`La bóveda ${name} no tiene ${amount}`);
  }
  console.log("Comprobado: 100.000.000 GRANO repartidos correctamente");

  const deployed = {
    network: network.name,
    chainId: Number(network.config.chainId),
    deployedAt: new Date().toISOString(),
    tx: receipt.hash,
    GranoToken: await token.getAddress(),
    GranoLauncher: launcherAddr,
    treasury,
    vesting: Object.fromEntries(Object.entries(vaults).map(([n, [a, amt, b]]) => [n, { address: a, amount: amt, beneficiary: b }])),
    heldByTreasury: { "Venta pública (pendiente de contrato)": 15_000_000, Liquidez: 10_000_000 },
  };
  const dir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${network.name}.json`), JSON.stringify(deployed, null, 2));
  console.log(`::notice title=GRANO desplegado::${JSON.stringify(deployed)}`);
}

main().catch((e) => {
  console.log(`::error title=Despliegue::${(e.shortMessage || e.message || String(e)).replace(/\s+/g, " ").slice(0, 400)}`);
  process.exitCode = 1;
});
