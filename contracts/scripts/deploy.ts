import { ethers } from "hardhat";

async function main() {
  console.log("Desplegando AliasRegistry...\n");

  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Balance:", ethers.formatEther(balance), "ETH/MATIC\n");

  const AliasRegistry = await ethers.getContractFactory("AliasRegistry");
  const registry = await AliasRegistry.deploy();

  await registry.waitForDeployment();

  const address = await registry.getAddress();
  console.log("AliasRegistry desplegado en:", address);
  console.log("\nPara verificar el contrato:");
  console.log(`npx hardhat verify --network <network> ${address}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
