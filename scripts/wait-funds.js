/**
 * Espera a que la wallet desplegadora tenga POL suficiente para pagar el despliegue.
 *   MIN_POL       saldo mínimo (por defecto 0.1)
 *   WAIT_MINUTES  tiempo máximo de espera (por defecto 30)
 * Los errores de conexión con la red se reintentan y se publican como avisos de GitHub.
 */
const { ethers } = require("hardhat");

async function main() {
  const [signer] = await ethers.getSigners();
  const min = ethers.parseEther(process.env.MIN_POL || "0.1");
  const deadline = Date.now() + Number(process.env.WAIT_MINUTES || 30) * 60_000;
  console.log(`Esperando al menos ${ethers.formatEther(min)} POL en ${signer.address}`);
  let warned = false;
  for (;;) {
    try {
      const bal = await ethers.provider.getBalance(signer.address);
      if (bal >= min) {
        console.log(`Saldo recibido: ${ethers.formatEther(bal)} POL`);
        return;
      }
      console.log(`Saldo actual: ${ethers.formatEther(bal)} POL. Vuelvo a mirar en 20 s…`);
    } catch (e) {
      const m = (e.shortMessage || e.message || String(e)).split("\n")[0];
      if (!warned) console.log(`::warning title=Error de conexion con la red::${m}`);
      warned = true;
      console.log(`Error de red, reintento: ${m}`);
    }
    if (Date.now() > deadline) throw new Error(`No llegó el POL a ${signer.address} a tiempo`);
    await new Promise((r) => setTimeout(r, 20_000));
  }
}

main().catch((e) => {
  console.log(`::error title=Esperar POL::${(e.message || String(e)).split("\n")[0]}`);
  process.exitCode = 1;
});
