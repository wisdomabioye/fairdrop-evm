import hre from "hardhat";
import { parseEther, Address, formatEther } from "viem";

const { viem } = await hre.network.connect();

/**
 * Helper script to transfer auction tokens to a specified address (usually the auction contract)
 *
 * Usage:
 * export AUCTION_TOKEN_ADDRESS=0x...
 * export RECIPIENT_ADDRESS=0x...  # The auction contract address
 * export AMOUNT=1000              # Amount in token units (will be converted to wei)
 *
 * npx hardhat run scripts/transfer-tokens.ts --network <network-name>
 */
async function main() {
  console.log("💸 Token Transfer Script\n");

  // ============ Configuration ============

  const AUCTION_TOKEN_ADDRESS = process.env.AUCTION_TOKEN_ADDRESS as Address;
  const RECIPIENT_ADDRESS = process.env.RECIPIENT_ADDRESS as Address;
  const AMOUNT = process.env.AMOUNT || "0";

  // ============ Validation ============

  if (!AUCTION_TOKEN_ADDRESS) {
    throw new Error("AUCTION_TOKEN_ADDRESS not set in environment");
  }

  if (!RECIPIENT_ADDRESS) {
    throw new Error("RECIPIENT_ADDRESS not set in environment. Set the auction contract address.");
  }

  if (AMOUNT === "0") {
    throw new Error("AMOUNT not set in environment. Set the number of tokens to transfer.");
  }

  const [sender] = await viem.getWalletClients();
  console.log(`Sender: ${sender.account.address}`);
  console.log(`Token: ${AUCTION_TOKEN_ADDRESS}`);
  console.log(`Recipient: ${RECIPIENT_ADDRESS}`);
  console.log(`Amount: ${AMOUNT} tokens\n`);

  // ============ Get Token Contract ============

  const token = await viem.getContractAt("IERC20", AUCTION_TOKEN_ADDRESS);

  // Get token info
  let tokenName = "Unknown";
  let tokenSymbol = "Unknown";
  let decimals = 18n;

  try {
    // Try to get ERC20 metadata (not all tokens have these)
    const nameResult = await token.read.name?.() as string;
    const symbolResult = await token.read.symbol?.() as string;
    const decimalsResult = await token.read.decimals() as number;

    tokenName = nameResult || "Unknown";
    tokenSymbol = symbolResult || "Unknown";
    decimals = BigInt(decimalsResult);
  } catch (e) {
    console.log("⚠️  Could not fetch token metadata (name/symbol)");
  }

  console.log(`📋 Token Info:`);
  console.log(`   Name: ${tokenName}`);
  console.log(`   Symbol: ${tokenSymbol}`);
  console.log(`   Decimals: ${decimals}\n`);

  // ============ Check Balance ============

  const balance = await token.read.balanceOf([sender.account.address]);
  const amountInWei = parseEther(AMOUNT);

  console.log(`💰 Balance Check:`);
  console.log(`   Your balance: ${balance} (${formatEther(balance)} tokens)`);
  console.log(`   Transfer amount: ${amountInWei} (${AMOUNT} tokens)\n`);

  if (balance < amountInWei) {
    throw new Error(
      `Insufficient balance. You have ${formatEther(balance)} tokens but trying to send ${AMOUNT} tokens`
    );
  }

  // ============ Confirm Transfer ============

  console.log("⚠️  You are about to transfer:");
  console.log(`   ${AMOUNT} ${tokenSymbol} tokens`);
  console.log(`   From: ${sender.account.address}`);
  console.log(`   To: ${RECIPIENT_ADDRESS}\n`);

  // ============ Execute Transfer ============

  console.log("🚀 Executing transfer...");

  const hash = await token.write.transfer([RECIPIENT_ADDRESS, amountInWei]);

  console.log(`Transaction hash: ${hash}`);

  // Wait for confirmation
  console.log("⏳ Waiting for confirmation...");

  // ============ Verify Transfer ============

  const newSenderBalance = await token.read.balanceOf([sender.account.address]);
  const recipientBalance = await token.read.balanceOf([RECIPIENT_ADDRESS]);

  console.log("\n✅ Transfer complete!");
  console.log("\n📊 Updated Balances:");
  console.log(`   Your balance: ${newSenderBalance} (${formatEther(newSenderBalance)} tokens)`);
  console.log(`   Recipient balance: ${recipientBalance} (${formatEther(recipientBalance)} tokens)\n`);

  // If recipient is an auction contract, show additional info
  try {
    const auction = await viem.getContractAt("FairdropAuction", RECIPIENT_ADDRESS);
    const totalSupply = await auction.read.totalSupply();

    console.log("🎯 Auction Contract Status:");
    console.log(`   Auction total supply: ${totalSupply} (${formatEther(totalSupply)} tokens)`);
    console.log(`   Contract balance: ${recipientBalance} (${formatEther(recipientBalance)} tokens)`);

    if (recipientBalance >= totalSupply) {
      console.log("   ✅ Auction is fully funded and ready for bids!");
    } else {
      const remaining = totalSupply - recipientBalance;
      console.log(`   ⚠️  Auction needs ${remaining} more tokens (${formatEther(remaining)} tokens)`);
    }
  } catch (e) {
    // Not an auction contract or couldn't read
    console.log("ℹ️  Recipient is not an auction contract or couldn't read auction data");
  }

  console.log("\n🎉 Done!");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\n❌ Error:", error.message);
    process.exit(1);
  });
