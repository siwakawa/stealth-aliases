import { ethers } from "hardhat";

async function main() {
  console.log("Desplegando AliasRegistryV2...\n");

  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Balance:", ethers.formatEther(balance), "ETH/MATIC\n");

  const AliasRegistryV2 = await ethers.getContractFactory("AliasRegistryV2");
  const registry = await AliasRegistryV2.deploy();

  await registry.waitForDeployment();

  const address = await registry.getAddress();
  console.log("AliasRegistryV2 desplegado en:", address);
  console.log("\nPara verificar el contrato:");
  console.log(`npx hardhat verify --network <network> ${address}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
