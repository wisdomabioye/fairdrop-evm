import hre from "hardhat";
import { parseEther, Address } from "viem";

const { viem } = await hre.network.connect();

/**
 * Helper script to create and properly fund a new auction
 *
 * Usage:
 * - For ERC20 payment: Set PAYMENT_TOKEN to token address
 * - For native token (ETH/MATIC): Set PAYMENT_TOKEN to "0x0000000000000000000000000000000000000000"
 */
async function main() {
  console.log("🎯 Creating new Fairdrop auction...\n");

  // ============ Configuration ============

  // Factory address (update this after deploying factory)
  const FACTORY_ADDRESS = process.env.FACTORY_ADDRESS as Address;

  // Auction token address (the token being sold)
  const AUCTION_TOKEN_ADDRESS = process.env.AUCTION_TOKEN_ADDRESS as Address;

  // Payment token address (use zero address for native token)
  const PAYMENT_TOKEN_ADDRESS = (process.env.PAYMENT_TOKEN_ADDRESS || "0x0000000000000000000000000000000000000000") as Address;

  // Auction parameters
  const START_PRICE = parseEther("1");        // 1 token (in payment token units)
  const FLOOR_PRICE = parseEther("0.1");      // 0.1 token
  const PRICE_DECREMENT = parseEther("0.01"); // 0.01 token per interval
  const PRICE_INTERVAL = 60n;                 // 60 seconds between price drops
  const AUCTION_SUPPLY = parseEther("10000"); // 10,000 tokens to auction
  const AUCTION_DURATION = 3600n;             // 1 hour auction

  // ============ Validation ============

  if (!FACTORY_ADDRESS) {
    throw new Error("FACTORY_ADDRESS not set in environment");
  }

  if (!AUCTION_TOKEN_ADDRESS) {
    throw new Error("AUCTION_TOKEN_ADDRESS not set in environment");
  }

  const [deployer] = await viem.getWalletClients();
  console.log(`Deploying from account: ${deployer.account.address}`);

  const isNativeToken = PAYMENT_TOKEN_ADDRESS === "0x0000000000000000000000000000000000000000";

  console.log("\n📋 Auction Configuration:");
  console.log("========================");
  console.log(`Factory: ${FACTORY_ADDRESS}`);
  console.log(`Auction Token: ${AUCTION_TOKEN_ADDRESS}`);
  console.log(`Payment Token: ${isNativeToken ? "Native Token (ETH/MATIC)" : PAYMENT_TOKEN_ADDRESS}`);
  console.log(`Start Price: ${START_PRICE} (${START_PRICE / 10n**18n} tokens)`);
  console.log(`Floor Price: ${FLOOR_PRICE} (${FLOOR_PRICE / 10n**18n} tokens)`);
  console.log(`Supply: ${AUCTION_SUPPLY} (${AUCTION_SUPPLY / 10n**18n} tokens)`);
  console.log(`Duration: ${AUCTION_DURATION} seconds\n`);

  // ============ Get Contracts ============

  const factory = await viem.getContractAt(
    "FairdropAuctionFactory",
    FACTORY_ADDRESS
  );

  const auctionToken = await viem.getContractAt(
    "IERC20",
    AUCTION_TOKEN_ADDRESS
  );

  // ============ Check Balance ============

  const balance = await auctionToken.read.balanceOf([deployer.account.address]);
  console.log(`Your auction token balance: ${balance} (${balance / 10n**18n} tokens)`);

  if (balance < AUCTION_SUPPLY) {
    throw new Error(`Insufficient auction tokens. Need ${AUCTION_SUPPLY}, have ${balance}`);
  }

  // ============ Create Auction ============

  console.log("\n🏗️  Creating auction via factory...");

  const hash = await factory.write.createAuction([
    START_PRICE,
    FLOOR_PRICE,
    PRICE_DECREMENT,
    PRICE_INTERVAL,
    AUCTION_SUPPLY,
    AUCTION_DURATION,
    AUCTION_TOKEN_ADDRESS,
    PAYMENT_TOKEN_ADDRESS,
  ]);

  console.log(`Transaction hash: ${hash}`);

  // Get the auction address
  const auctionCount = await factory.read.auctionCount();
  const auctionAddress = await factory.read.getAuction([auctionCount - 1n]);

  console.log(`✅ Auction created at: ${auctionAddress}`);

  // ============ Fund Auction ============

  console.log("\n💰 Funding auction with tokens...");

  // Transfer auction tokens to the auction contract
  const transferHash = await auctionToken.write.transfer([
    auctionAddress,
    AUCTION_SUPPLY
  ]);

  console.log(`Transfer transaction hash: ${transferHash}`);

  // Verify transfer
  const auctionBalance = await auctionToken.read.balanceOf([auctionAddress]);
  console.log(`✅ Auction contract balance: ${auctionBalance} (${auctionBalance / 10n**18n} tokens)`);

  if (auctionBalance < AUCTION_SUPPLY) {
    throw new Error("Token transfer failed - auction not properly funded");
  }

  // ============ Get Auction Info ============

  const auction = await viem.getContractAt("FairdropAuction", auctionAddress);
  const auctionState = await auction.read.getAuctionState();

  console.log("\n📊 Auction Status:");
  console.log("==================");
  console.log(`Address: ${auctionAddress}`);
  console.log(`Status: ${auctionState[0] === 1 ? "Active" : "Not Active"}`);
  console.log(`Current Price: ${auctionState[1]} (${auctionState[1] / 10n**18n} tokens)`);
  console.log(`Total Committed: ${auctionState[2]}`);
  console.log(`Remaining Supply: ${auctionState[3]} (${auctionState[3] / 10n**18n} tokens)`);
  console.log(`Time Remaining: ${auctionState[4]} seconds`);

  console.log("\n✨ Success! Auction is ready for bids!");

  if (isNativeToken) {
    console.log("\n📝 To place a bid with native token:");
    console.log(`   auction.placeBid(quantity, { value: requiredAmount })`);
    console.log(`   Example: placeBid(parseEther("100"), { value: parseEther("10") })`);
  } else {
    console.log("\n📝 To place a bid with ERC20:");
    console.log(`   1. Approve payment token: paymentToken.approve(auctionAddress, amount)`);
    console.log(`   2. Place bid: auction.placeBid(quantity)`);
  }

  console.log("\n📋 Summary:");
  console.log("===========");
  console.log(`Factory: ${FACTORY_ADDRESS}`);
  console.log(`Auction: ${auctionAddress}`);
  console.log(`Auction Token: ${AUCTION_TOKEN_ADDRESS}`);
  console.log(`Payment Token: ${isNativeToken ? "Native (ETH/MATIC)" : PAYMENT_TOKEN_ADDRESS}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\n❌ Error:", error.message);
    process.exit(1);
  });
