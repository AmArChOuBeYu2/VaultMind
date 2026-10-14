require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

const MONAD_PRIVATE_KEY = process.env.MONAD_PRIVATE_KEY || "0x0000000000000000000000000000000000000000000000000000000000000001";

module.exports = {
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  networks: {
    hardhat: {},
    monadTestnet: {
      url: process.env.NEXT_PUBLIC_MONAD_RPC_URL || "https://testnet-rpc.monad.xyz",
      accounts: [MONAD_PRIVATE_KEY],
      chainId: 10143,
    },
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
};
