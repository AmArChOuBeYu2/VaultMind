import "@nomicfoundation/hardhat-toolbox";
import hre from "hardhat";

async function main() {
  console.log("Deploying GrantRegistry smart contract to Monad Testnet...");

  const GrantRegistry = await hre.ethers.getContractFactory("GrantRegistry");
  const registry = await GrantRegistry.deploy();

  await registry.waitForDeployment();

  const contractAddress = await registry.getAddress();
  console.log("----------------------------------------------------");
  console.log("GrantRegistry deployed successfully!");
  console.log(`Contract Address: ${contractAddress}`);
  console.log("----------------------------------------------------");
  console.log("Add this address to your .env file as:");
  console.log(`NEXT_PUBLIC_GRANT_REGISTRY_ADDRESS=${contractAddress}`);
}

main().catch((error) => {
  console.error("Deployment failed:", error);
  process.exitCode = 1;
});
