import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "@nomicfoundation/hardhat-verify";
import * as dotenv from "dotenv";

dotenv.config();

const PRIVATE_KEY = process.env.PRIVATE_KEY || "0x0000000000000000000000000000000000000000000000000000000000000000";

const config: HardhatUserConfig = {
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
    // Polygon Mainnet (muy barato ~$0.01-0.10 por tx)
    polygon: {
      url: process.env.POLYGON_RPC || "",
      accounts: [PRIVATE_KEY],
      chainId: 137,
    },
    // Polygon Amoy Testnet
    polygonAmoy: {
      url: process.env.POLYGON_AMOY_RPC || "",
      accounts: [PRIVATE_KEY],
      chainId: 80002,
    },
    // Arbitrum Sepolia Testnet
    arbitrumSepolia: {
      url: process.env.ARBITRUM_SEPOLIA_RPC || "",
      accounts: [PRIVATE_KEY],
      chainId: 421614,
    },
    // Base Sepolia Testnet
    baseSepolia: {
      url: process.env.BASE_SEPOLIA_RPC || "",
      accounts: [PRIVATE_KEY],
      chainId: 84532,
    },
  },
  // Verificación pública sin clave de API ni registro.
  // Nota: el plugin instalado consulta un endpoint de Sourcify que ya no existe
  // (/check-all-by-addresses). La verificación se hizo contra la API v2, que
  // además reenvía el resultado a Etherscan/Polygonscan:
  //   POST https://sourcify.dev/server/v2/verify/137/<direccion>
  //   cuerpo: { stdJsonInput, compilerVersion, contractIdentifier }
  // El stdJsonInput sale de artifacts/build-info/*.json (campo "input").
  sourcify: {
    enabled: true,
  },
  etherscan: {
    apiKey: {
      polygon: process.env.POLYGONSCAN_API_KEY || "",
      polygonAmoy: process.env.POLYGONSCAN_API_KEY || "",
      arbitrumSepolia: process.env.ARBISCAN_API_KEY || "",
      baseSepolia: process.env.BASESCAN_API_KEY || "",
    },
    customChains: [
      {
        network: "polygonAmoy",
        chainId: 80002,
        urls: {
          apiURL: "https://api-amoy.polygonscan.com/api",
          browserURL: "https://amoy.polygonscan.com",
        },
      },
    ],
  },
  paths: {
    sources: "./src",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
};

export default config;
