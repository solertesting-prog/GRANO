const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

const G = (n) => ethers.parseUnits(String(n), 18);
const MONTH = 30 * 24 * 3600;

describe("GranoLauncher", function () {
  async function launch() {
    const [deployer, safe, eco, prod, team, adv] = await ethers.getSigners();
    const launcher = await ethers.deployContract("GranoLauncher", [
      safe.address,
      eco.address,
      prod.address,
      team.address,
      adv.address,
    ]);
    const receipt = await launcher.deploymentTransaction().wait();
    const token = await ethers.getContractAt("GranoToken", await launcher.token());
    const v = async (fn) => ethers.getContractAt("GranoVesting", await launcher[fn]());
    return { deployer, safe, eco, prod, team, adv, launcher, token, receipt, v };
  }

  it("crea todo en una sola transacción y reparte los 100M", async function () {
    const { launcher, token, safe, deployer, receipt } = await launch();
    expect(receipt.status).to.equal(1);
    expect(await token.totalSupply()).to.equal(G(100_000_000));
    expect(await token.balanceOf(safe.address)).to.equal(G(25_000_000));
    expect(await token.balanceOf(await launcher.ecosystemVault())).to.equal(G(25_000_000));
    expect(await token.balanceOf(await launcher.producersVault())).to.equal(G(15_000_000));
    expect(await token.balanceOf(await launcher.treasuryVault())).to.equal(G(15_000_000));
    expect(await token.balanceOf(await launcher.teamVault())).to.equal(G(15_000_000));
    expect(await token.balanceOf(await launcher.advisorsVault())).to.equal(G(5_000_000));
    expect(await token.balanceOf(await launcher.getAddress())).to.equal(0);
    expect(await token.balanceOf(deployer.address)).to.equal(0);
    console.log(`::notice title=Gas del lanzamiento::${receipt.gasUsed.toString()}`);
  });

  it("asigna cada bóveda a su beneficiario con sus plazos", async function () {
    const { v, safe, eco, team } = await launch();
    const start = BigInt(await time.latest());
    const ecoV = await v("ecosystemVault");
    expect(await ecoV.owner()).to.equal(eco.address);
    expect(await ecoV.duration()).to.equal(BigInt(48 * MONTH));
    const teamV = await v("teamVault");
    expect(await teamV.owner()).to.equal(team.address);
    expect(await teamV.start()).to.equal(start + BigInt(12 * MONTH));
    expect(await teamV.duration()).to.equal(BigInt(36 * MONTH));
    const trV = await v("treasuryVault");
    expect(await trV.owner()).to.equal(safe.address);
    expect(await trV.start()).to.equal(start + BigInt(6 * MONTH));
  });

  it("el equipo no puede retirar nada antes de 12 meses", async function () {
    const { v, token, team } = await launch();
    const teamV = await v("teamVault");
    const tokenAddr = await token.getAddress();
    expect(await teamV["releasable(address)"](tokenAddr)).to.equal(0);
    await time.increase(11 * MONTH);
    expect(await teamV["releasable(address)"](tokenAddr)).to.equal(0);
    await time.increase(1 * MONTH + 18 * MONTH);
    const half = await teamV["releasable(address)"](tokenAddr);
    expect(half).to.be.closeTo(G(7_500_000), G(10_000));
    await teamV["release(address)"](tokenAddr);
    expect(await token.balanceOf(team.address)).to.be.closeTo(G(7_500_000), G(10_000));
  });

  it("rechaza direcciones vacías", async function () {
    const [, safe] = await ethers.getSigners();
    const F = await ethers.getContractFactory("GranoLauncher");
    await expect(
      F.deploy(safe.address, ethers.ZeroAddress, safe.address, safe.address, safe.address)
    ).to.be.revertedWith("GRANO: direccion cero");
  });
});
