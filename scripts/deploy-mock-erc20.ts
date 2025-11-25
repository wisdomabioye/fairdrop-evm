import hre from "hardhat";

const { viem } = await hre.network.connect();

async function main() {
  console.log("🚀 Deploying MockERC20 to Polygon Amoy...\n");

  const [deployer] = await viem.getWalletClients();
  console.log(`Deploying from account: ${deployer.account.address}\n`);

  // MockERC20 constructor parameters
  const name = "Test Token";
  const symbol = "TEST";
  const totalSupply = 1_000_000n * 10n ** 18n; // 1 million tokens

  console.log(`Token Name: ${name}`);
  console.log(`Token Symbol: ${symbol}`);
  console.log(`Total Supply: ${totalSupply.toString()}\n`);

  // Deploy MockERC20
  const mockToken = await viem.deployContract("MockERC20", [
    name,
    symbol,
    totalSupply,
  ]);

  console.log("✅ MockERC20 deployed to:", mockToken.address);
  console.log("\n📋 Deployment Summary:");
  console.log("=======================");
  console.log(`Contract: ${mockToken.address}`);
  console.log(`Network: Polygon Amoy`);
  console.log(`Deployer: ${deployer.account.address}`);
  console.log(`Total Supply: ${totalSupply.toString()}`);
  console.log("\n🎉 Deployment complete!");
  console.log("\nTo verify the contract, run:");
  console.log(`npx hardhat verify --network polygon_amoy ${mockToken.address} "${name}" "${symbol}" "${totalSupply}"`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
