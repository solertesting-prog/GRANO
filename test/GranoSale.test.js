const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time, loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

const G = (n) => ethers.parseUnits(String(n), 18); // GRANO
const U = (n) => ethers.parseUnits(String(n), 6); // USDC

describe("GRANO", function () {
  async function deploy() {
    const [owner, treasury, alice, bob] = await ethers.getSigners();

    const token = await ethers.deployContract("GranoToken", [treasury.address]);
    const usdc = await ethers.deployContract("MockUSDC");

    const now = await time.latest();
    const cfg = {
      grano: await token.getAddress(),
      paymentToken: await usdc.getAddress(),
      treasury: treasury.address,
      price: 50_000n, // 0,05 USDC por GRANO
      saleCap: G(15_000_000),
      startTime: now + 3600,
      endTime: now + 3600 + 30 * 24 * 3600,
      minPurchase: G(1_000), // 50 USDC
      maxPerWallet: G(200_000), // 10.000 USDC
      allowlistEnabled: false,
    };
    const sale = await ethers.deployContract("GranoSale", [cfg, owner.address]);
    const saleAddr = await sale.getAddress();

    await token.connect(treasury).transfer(saleAddr, cfg.saleCap);
    for (const s of [alice, bob]) {
      await usdc.mint(s.address, U(1_000_000));
      await usdc.connect(s).approve(saleAddr, ethers.MaxUint256);
    }
    return { owner, treasury, alice, bob, token, usdc, sale, cfg };
  }

  describe("GranoToken", function () {
    it("crea un suministro fijo de 100M para el distribuidor", async function () {
      const { token, treasury } = await loadFixture(deploy);
      expect(await token.totalSupply()).to.equal(G(100_000_000));
      expect(await token.name()).to.equal("Grano");
      expect(await token.symbol()).to.equal("GRANO");
      expect(await token.balanceOf(treasury.address)).to.equal(G(85_000_000));
    });

    it("no tiene función para emitir más tokens", async function () {
      const { token } = await loadFixture(deploy);
      expect(token.interface.getFunction("mint")).to.equal(null);
    });

    it("la quema reduce el suministro total", async function () {
      const { token, treasury } = await loadFixture(deploy);
      await token.connect(treasury).burn(G(1_000));
      expect(await token.totalSupply()).to.equal(G(99_999_000));
    });
  });

  describe("GranoSale", function () {
    it("rechaza compras antes del inicio", async function () {
      const { sale, alice } = await loadFixture(deploy);
      await expect(sale.connect(alice).buy(G(1_000))).to.be.revertedWithCustomError(sale, "SaleNotActive");
    });

    it("cobra 0,05 USDC por GRANO, envía el pago a tesorería y entrega los tokens", async function () {
      const { sale, token, usdc, alice, treasury } = await loadFixture(deploy);
      await time.increase(3600);
      const before = await usdc.balanceOf(treasury.address);
      await expect(sale.connect(alice).buy(G(10_000)))
        .to.emit(sale, "Purchased")
        .withArgs(alice.address, G(10_000), U(500));
      expect(await token.balanceOf(alice.address)).to.equal(G(10_000));
      expect((await usdc.balanceOf(treasury.address)) - before).to.equal(U(500));
      expect(await usdc.balanceOf(await sale.getAddress())).to.equal(0);
      expect(await sale.totalSold()).to.equal(G(10_000));
    });

    it("redondea el coste hacia arriba en cantidades fraccionarias", async function () {
      const { sale } = await loadFixture(deploy);
      // 1 wei de GRANO cuesta > 0 => 1 unidad mínima de USDC
      expect(await sale.quote(1n)).to.equal(1n);
      expect(await sale.quote(G(1))).to.equal(50_000n);
    });

    it("aplica el mínimo por compra", async function () {
      const { sale, alice } = await loadFixture(deploy);
      await time.increase(3600);
      await expect(sale.connect(alice).buy(G(999))).to.be.revertedWithCustomError(sale, "BelowMinimum");
    });

    it("aplica el máximo acumulado por wallet", async function () {
      const { sale, alice } = await loadFixture(deploy);
      await time.increase(3600);
      await sale.connect(alice).buy(G(150_000));
      await expect(sale.connect(alice).buy(G(50_001))).to.be.revertedWithCustomError(sale, "WalletLimitExceeded");
      await sale.connect(alice).buy(G(50_000));
      expect(await sale.purchased(alice.address)).to.equal(G(200_000));
    });

    it("respeta la lista de verificados (KYC) cuando está activa", async function () {
      const { sale, owner, alice, bob } = await loadFixture(deploy);
      await time.increase(3600);
      await sale.connect(owner).setAllowlistEnabled(true);
      await sale.connect(owner).setAllowlist([alice.address], true);
      await sale.connect(alice).buy(G(1_000));
      await expect(sale.connect(bob).buy(G(1_000))).to.be.revertedWithCustomError(sale, "NotAllowlisted");
    });

    it("se puede pausar y reanudar", async function () {
      const { sale, owner, alice } = await loadFixture(deploy);
      await time.increase(3600);
      await sale.connect(owner).pause();
      await expect(sale.connect(alice).buy(G(1_000))).to.be.revertedWithCustomError(sale, "EnforcedPause");
      await sale.connect(owner).unpause();
      await sale.connect(alice).buy(G(1_000));
    });

    it("solo el propietario administra", async function () {
      const { sale, alice } = await loadFixture(deploy);
      await expect(sale.connect(alice).pause()).to.be.revertedWithCustomError(sale, "OwnableUnauthorizedAccount");
      await expect(sale.connect(alice).withdrawUnsold()).to.be.revertedWithCustomError(
        sale,
        "OwnableUnauthorizedAccount"
      );
    });

    it("rechaza compras tras el cierre y devuelve lo no vendido a tesorería", async function () {
      const { sale, token, owner, alice, treasury, cfg } = await loadFixture(deploy);
      await time.increase(3600);
      await sale.connect(alice).buy(G(100_000));
      await expect(sale.connect(owner).withdrawUnsold()).to.be.revertedWithCustomError(sale, "SaleNotEnded");

      await time.increaseTo(cfg.endTime);
      await expect(sale.connect(alice).buy(G(1_000))).to.be.revertedWithCustomError(sale, "SaleNotActive");

      const before = await token.balanceOf(treasury.address);
      await sale.connect(owner).withdrawUnsold();
      expect((await token.balanceOf(treasury.address)) - before).to.equal(cfg.saleCap - G(100_000));
    });

    it("no permite superar el tope total", async function () {
      const { token, usdc, treasury, owner, alice, bob } = await loadFixture(deploy);
      const now = await time.latest();
      const small = await ethers.deployContract("GranoSale", [
        {
          grano: await token.getAddress(),
          paymentToken: await usdc.getAddress(),
          treasury: treasury.address,
          price: 50_000n,
          saleCap: G(5_000),
          startTime: now + 10,
          endTime: now + 1000,
          minPurchase: G(1_000),
          maxPerWallet: G(5_000),
          allowlistEnabled: false,
        },
        owner.address,
      ]);
      await token.connect(treasury).transfer(await small.getAddress(), G(5_000));
      await usdc.connect(alice).approve(await small.getAddress(), ethers.MaxUint256);
      await usdc.connect(bob).approve(await small.getAddress(), ethers.MaxUint256);
      await time.increase(10);
      await small.connect(alice).buy(G(4_000));
      await expect(small.connect(bob).buy(G(1_001))).to.be.revertedWithCustomError(small, "CapExceeded");
      await small.connect(bob).buy(G(1_000));
      expect(await small.isActive()).to.equal(false);
    });

    it("rechaza configuraciones inválidas", async function () {
      const { token, usdc, treasury, owner, cfg } = await loadFixture(deploy);
      const bad = { ...cfg, endTime: cfg.startTime };
      const F = await ethers.getContractFactory("GranoSale");
      await expect(F.deploy(bad, owner.address)).to.be.revertedWithCustomError(F, "InvalidConfig");
    });
  });
});
