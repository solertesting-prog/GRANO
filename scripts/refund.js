/**
 * Devuelve el POL que sobre en la wallet desplegadora a REFUND_TO, para no perderlo
 * cuando la wallet es temporal. Se ejecuta siempre al final, haya ido bien o mal.
 */
const { ethers } = require("hardhat");

async function main() {
  const to = process.env.REFUND_TO;
  if (!to || !ethers.isAddress(to)) return console.log("Sin REFUND_TO: nada que devolver");
  const [signer] = await ethers.getSigners();
  const bal = await ethers.provider.getBalance(signer.address);
  const fee = await ethers.provider.getFeeData();
  const price = (fee.maxFeePerGas || fee.gasPrice) * 2n;
  const cost = 21000n * price;
  if (bal <= cost) return console.log(`Saldo ${ethers.formatEther(bal)} POL: no compensa devolverlo`);
  const tx = await signer.sendTransaction({ to, value: bal - cost, gasLimit: 21000n, maxFeePerGas: price, maxPriorityFeePerGas: fee.maxPriorityFeePerGas || price });
  await tx.wait();
  console.log(`::notice title=POL devuelto::${ethers.formatEther(bal - cost)} POL devueltos a ${to}`);
}

main().catch((e) => {
  console.log(`::warning title=Devolucion::${(e.shortMessage || e.message || String(e)).split("\n")[0]}`);
});
