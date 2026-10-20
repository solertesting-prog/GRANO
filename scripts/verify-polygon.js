/**
 * Publica el código fuente de los contratos desplegados (deployments/polygon.json)
 * en Sourcify y, si hay POLYGONSCAN_API_KEY, también en Polygonscan.
 * Así cualquiera puede leer el código y comprobar que no hay funciones ocultas.
 */
const { run } = require("hardhat");
const d = require("../deployments/polygon.json");

const MONTH = 30 * 24 * 3600;
const start = Math.floor(new Date(d.deployedAt).getTime() / 1000);

async function verify(label, address, contract, args) {
  const report = (where, e) => {
    const m = (e.message || String(e)).replace(/\s+/g, " ").slice(0, 300);
    const level = /already (been )?verified|already partially|perfect/i.test(m) ? "notice" : "warning";
    console.log(`::${level} title=${label} (${where})::${m}`);
  };
  if (!process.env.POLYGONSCAN_API_KEY) return console.log(`::warning title=${label}::Falta la clave de Etherscan`);
  try {
    await run("verify:verify", { address, contract, constructorArguments: args });
    console.log(`::notice title=Verificado en Polygonscan::${label} ${address}`);
  } catch (e) {
    report("Polygonscan", e);
  }
}

async function main() {
  const t = d.treasury;
  await verify("GranoLauncher", d.GranoLauncher, "contracts/GranoLauncher.sol:GranoLauncher", [t, t, t, t, t]);
  await verify("GranoToken", d.GranoToken, "contracts/GranoToken.sol:GranoToken", [d.GranoLauncher]);
  const plan = [
    ["Ecosistema y recompensas", 0, 48],
    ["Productores y cooperativas", 0, 36],
    ["Tesorería", 6, 24],
    ["Equipo", 12, 36],
    ["Asesores y socios", 6, 24],
  ];
  for (const [name, lock, months] of plan) {
    const v = d.vesting[name];
    await verify(`Bóveda ${name}`, v.address, "contracts/GranoVesting.sol:GranoVesting", [
      v.beneficiary,
      start + lock * MONTH,
      months * MONTH,
    ]);
  }
}

main();
