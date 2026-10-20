/**
 * Devuelve el POL que sobre en la wallet desplegadora a REFUND_TO, para no perderlo
 * cuando la wallet es temporal. Se ejecuta siempre al final, haya ido bien o mal.
 * Si quedó una transacción atascada, la sustituye (mismo nonce, más gas) por la devolución.
 */
const { ethers } = require("hardhat");

async function main() {
  const to = process.env.REFUND_TO;
  if (!to || !ethers.isAddress(to)) return console.log("Sin REFUND_TO: nada que devolver");
  const [signer] = await ethers.getSigners();
  const p = ethers.provider;
  const [latest, pending] = await Promise.all([
    p.getTransactionCount(signer.address, "latest"),
    p.getTransactionCount(signer.address, "pending"),
  ]);
  const net = BigInt(await p.send("eth_gasPrice", []));
  const floor = ethers.parseUnits("300", "gwei");
  const gasPrice = net * 3n > floor ? net * 3n : floor;
  const cost = 21000n * gasPrice;
  const bal = await p.getBalance(signer.address);
  if (pending > latest) console.log(`Transacción atascada (nonce ${latest}): se sustituye por la devolución`);
  if (bal <= cost) return console.log(`Saldo ${ethers.formatEther(bal)} POL: no compensa devolverlo`);
  const tx = await signer.sendTransaction({ to, value: bal - cost, gasLimit: 21000n, gasPrice, nonce: latest, type: 0 });
  await tx.wait();
  console.log(`::notice title=POL devuelto::${ethers.formatEther(bal - cost)} POL devueltos a ${to}`);
}

main().catch((e) => {
  console.log(`::warning title=Devolucion::${(e.shortMessage || e.message || String(e)).replace(/\s+/g, " ").slice(0, 300)}`);
});
