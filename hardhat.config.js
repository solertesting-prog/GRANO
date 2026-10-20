require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

const { PRIVATE_KEY, AMOY_RPC_URL, POLYGON_RPC_URL, POLYGONSCAN_API_KEY } = process.env;
const accounts = PRIVATE_KEY ? [PRIVATE_KEY] : [];
// Precio del gas fijo (wei) calculado justo antes de desplegar. Polygon exige una propina
// mínima de ~25-30 gwei y algunos nodos devuelven estimaciones demasiado bajas.
const gasPrice = process.env.GAS_PRICE_WEI ? Number(process.env.GAS_PRICE_WEI) : "auto";

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.24",
    settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: "cancun" },
  },
  networks: {
    amoy: {
      url: AMOY_RPC_URL || "https://rpc-amoy.polygon.technology",
      chainId: 80002,
      accounts,
      gasPrice,
    },
    polygon: {
      url: POLYGON_RPC_URL || "https://polygon-rpc.com",
      chainId: 137,
      accounts,
      gasPrice,
    },
  },
  etherscan: { apiKey: POLYGONSCAN_API_KEY || "" },
};
