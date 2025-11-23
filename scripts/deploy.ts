import hre from "hardhat";

const { viem, networkConfig } = await hre.network.connect();

async function main() {
  console.log("🚀 Starting Fairdrop deployment...\n");

  // Deploy Factory
  const PLATFORM_FEE = 100n; // 1%
  const [deployer] = await viem.getWalletClients();
  const feeRecipient = deployer.account.address;

  console.log(`Deploying from account: ${deployer.account.address}`);
  console.log(`Platform fee: ${PLATFORM_FEE} basis points (1%)`);
  console.log(`Fee recipient: ${feeRecipient}\n`);

  const factory = await viem.deployContract("FairdropAuctionFactory", [
    PLATFORM_FEE,
    feeRecipient,
  ]);

  console.log("✅ FairdropAuctionFactory deployed to:", factory.address);

  // Deploy Mock Tokens for testing (optional - only on local networks)
  const networkName = networkConfig.chainId;
  const isLocalNetwork = networkName === 31337 || networkName === 1337; // Hardhat/Localhost chain IDs

  if (isLocalNetwork) {
    console.log("\n📦 Deploying mock tokens for testing...");

    const auctionToken = await viem.deployContract("MockERC20", [
      "Test Auction Token",
      "TAUCT",
      1_000_000n * 10n ** 18n,
    ]);

    const paymentToken = await viem.deployContract("MockERC20", [
      "Test Payment Token",
      "TPAY",
      1_000_000n * 10n ** 18n,
    ]);

    console.log("✅ Mock Auction Token deployed to:", auctionToken.address);
    console.log("✅ Mock Payment Token deployed to:", paymentToken.address);

    // Create a test auction
    console.log("\n🎯 Creating test auction...");

    const START_PRICE = 1n * 10n ** 18n; // 1 token
    const FLOOR_PRICE = 1n * 10n ** 17n; // 0.1 token
    const PRICE_DECREMENT = 1n * 10n ** 16n; // 0.01 token per interval
    const PRICE_INTERVAL = 60n; // 60 seconds
    const AUCTION_SUPPLY = 10_000n * 10n ** 18n; // 10,000 tokens
    const AUCTION_DURATION = 3600n; // 1 hour

    await factory.write.createAuction([
      START_PRICE,
      FLOOR_PRICE,
      PRICE_DECREMENT,
      PRICE_INTERVAL,
      AUCTION_SUPPLY,
      AUCTION_DURATION,
      auctionToken.address,
      paymentToken.address,
    ]);

    const testAuction = await factory.read.getAuction([0n]);

    console.log("✅ Test Auction deployed to:", testAuction);

    // Transfer auction tokens to the auction contract
    await auctionToken.write.transfer([testAuction, AUCTION_SUPPLY]);

    console.log("✅ Auction tokens transferred to auction contract");

    console.log("\n📋 Deployment Summary:");
    console.log("=======================");
    console.log(`Factory: ${factory.address}`);
    console.log(`Auction Token: ${auctionToken.address}`);
    console.log(`Payment Token: ${paymentToken.address}`);
    console.log(`Test Auction: ${testAuction}`);
    console.log("\n🎉 Deployment complete!");
  } else {
    console.log("\n📋 Deployment Summary:");
    console.log("=======================");
    console.log(`Factory: ${factory.address}`);
    console.log("\n🎉 Deployment complete!");
    console.log("\nNext steps:");
    console.log("1. Create your auction using the factory contract");
    console.log("2. Transfer auction tokens to the auction contract");
    console.log("3. Users can start bidding!");
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
