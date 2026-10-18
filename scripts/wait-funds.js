/**
 * Espera a que la wallet desplegadora tenga POL suficiente para pagar el despliegue.
 *   MIN_POL       saldo mínimo (por defecto 0.1)
 *   WAIT_MINUTES  tiempo máximo de espera (por defecto 30)
 */
const { ethers } = require("hardhat");

async function main() {
  const [signer] = await ethers.getSigners();
  const min = ethers.parseEther(process.env.MIN_POL || "0.1");
  const deadline = Date.now() + Number(process.env.WAIT_MINUTES || 30) * 60_000;
  console.log(`Esperando al menos ${ethers.formatEther(min)} POL en ${signer.address}`);
  for (;;) {
    const bal = await ethers.provider.getBalance(signer.address);
    if (bal >= min) {
      console.log(`Saldo recibido: ${ethers.formatEther(bal)} POL`);
      return;
    }
    if (Date.now() > deadline) throw new Error(`No llegó el POL a ${signer.address} a tiempo`);
    console.log(`Saldo actual: ${ethers.formatEther(bal)} POL. Vuelvo a mirar en 20 s…`);
    await new Promise((r) => setTimeout(r, 20_000));
  }
}

main().catch((e) => {
  console.error(e.message || e);
  process.exitCode = 1;
});
