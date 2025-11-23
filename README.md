## Overview

This repository contains the complete implementation of Fairdrop - a gas-optimized Dutch auction protocol for Ethereum and EVM-compatible chains. The implementation follows the 5-stage plan outlined in the Fairdrop whitepaper.

## Architecture

### Core Contracts

1. **FairdropAuction.sol** - Main auction contract with payment integration and claiming
2. **FairdropAuctionAdvanced.sol** - Extended auction with whitelist and pro-rata features
3. **FairdropAuctionFactory.sol** - Factory for deploying new auction instances
4. **MockERC20.sol** - Testing token implementation


## Fairdrop EVM - Gas-Optimized Dutch Auction Protocol

A production-ready, gas-optimized implementation of the Fairdrop Dutch auction protocol for Ethereum and EVM-compatible chains.

## Features

✅ **Complete Implementation** - All 5 stages from the whitepaper
✅ **Gas Optimized** - Packed storage, unchecked math, custom reentrancy guards
✅ **Battle-Tested** - Comprehensive test suite covering all scenarios
✅ **Factory Pattern** - Deploy multiple auctions through a single factory
✅ **Advanced Features** - Whitelist, pro-rata allocation, max allocations
✅ **Multi-Token Support** - ERC20 tokens or native ETH
✅ **Security** - Reentrancy protection, access control, input validation

## Key Parameters

### Auction Configuration

- `startPrice` - Initial price per token (in wei)
- `floorPrice` - Minimum price per token (in wei)
- `priceDecrement` - Amount to decrease price each interval (in wei)
- `priceInterval` - Time between price decreases (in seconds)
- `totalSupply` - Total tokens available for auction
- `duration` - Total auction duration (in seconds)
- `auctionToken` - Address of token being auctioned
- `paymentToken` - Address of payment token (address(0) for ETH)

### Example Configuration

For a 1-hour auction starting at 1 token, ending at 0.1 token:

```javascript
startPrice: 1 * 10^18        // 1 token
floorPrice: 0.1 * 10^18      // 0.1 token
priceDecrement: 0.01 * 10^18 // 0.01 token per interval
priceInterval: 60            // 60 seconds
totalSupply: 100000 * 10^18  // 100,000 tokens
duration: 3600               // 1 hour
```

### Price Calculation

The auction uses a descending price model:

```
currentPrice = max(startPrice - (intervals * priceDecrement), floorPrice)

where:
  intervals = (block.timestamp - startTime) / priceInterval
```

## Quick Start

### Installation

```bash
# Clone the repository
git clone <your-repo-url>
cd fairdrop-evm

# Install dependencies
pnpm install

# Compile contracts
npx hardhat compile
```

### Run Tests

```bash
# Run all tests
npx hardhat test

# Run specific test file
npx hardhat test test/FairdropAuction.test.ts
npx hardhat test test/FairdropAuctionFactory.test.ts
```

### Deploy

```bash
# Deploy to local network
npx hardhat run scripts/deploy.ts

# Deploy to testnet (configure network first)
npx hardhat run scripts/deploy.ts --network sepolia
```

## Contracts

### FairdropAuction.sol

Main auction contract implementing:
- Descending price model (Dutch auction)
- Uniform clearing price (everyone pays the same)
- ERC20 and ETH payment support
- Automatic refunds for overpayment
- Owner withdrawal functions

**Gas Cost**: ~3M to deploy, ~80-120k per bid

### FairdropAuctionAdvanced.sol

Extended auction with:
- Whitelist functionality for private sales
- Pro-rata allocation for oversold auctions
- Per-address max allocation limits
- Batch whitelist management

**Gas Cost**: ~3.5M to deploy

### FairdropAuctionFactory.sol

Factory for creating auctions:
- Deploy new auction instances
- Track all created auctions
- Platform fee management (1-3%)
- Auction discovery and pagination

**Gas Cost**: ~2.5M to deploy

## Usage Example

### Create an Auction

```solidity
import "./FairdropAuctionFactory.sol";

// 1. Deploy factory (or use existing)
FairdropAuctionFactory factory = new FairdropAuctionFactory(
    100,              // 1% platform fee
    feeRecipient
);

// 2. Create auction
address auction = factory.createAuction(
    1 ether,          // Start price: 1 ETH per token
    0.1 ether,        // Floor price: 0.1 ETH per token
    0.01 ether,       // Decrement: 0.01 ETH per interval
    300,              // Interval: 5 minutes
    1000000 * 10**18, // Supply: 1M tokens
    86400,            // Duration: 24 hours
    tokenAddress,     // Your token address
    address(0)        // ETH payment (use token address for ERC20)
);

// 3. Transfer tokens to auction
IERC20(tokenAddress).transfer(auction, 1000000 * 10**18);
```

### Place a Bid

```solidity
// For ETH payment
FairdropAuction(auction).placeBid{value: 1 ether}(1000 * 10**18);

// For ERC20 payment
IERC20(paymentToken).approve(auction, 1000 ether);
FairdropAuction(auction).placeBid(1000 * 10**18);
```

### Claim Tokens

```solidity
// After auction ends and is finalized
FairdropAuction(auction).claim();

// You receive:
// - Your tokens at clearing price
// - Refund for (bidPrice - clearingPrice) * quantity
```

## How It Works

### Dutch Auction Model

1. **Price Descends Over Time**
   ```
   currentPrice = max(
     startPrice - (elapsedIntervals * priceDecrement),
     floorPrice
   )
   ```

2. **Users Bid at Current Price**
   - Each bid locks in payment at current price
   - No gas wars or front-running advantages

3. **Uniform Clearing**
   - All participants pay the same final price
   - Automatic refunds for overpayment

### Example Timeline

```
Hour 0: Price = 1.00 ETH → User A bids 100 tokens (pays 100 ETH)
Hour 2: Price = 0.80 ETH → User B bids 200 tokens (pays 160 ETH)
Hour 4: Price = 0.60 ETH → User C bids 300 tokens (pays 180 ETH)
Hour 6: Auction ends, Price = 0.50 ETH (clearing price)

Claims:
User A: Gets 100 tokens, Refund = (1.00 - 0.50) * 100 = 50 ETH
User B: Gets 200 tokens, Refund = (0.80 - 0.50) * 200 = 60 ETH
User C: Gets 300 tokens, Refund = (0.60 - 0.50) * 300 = 30 ETH
```

## Advanced Features

### Whitelist Mode

```solidity
FairdropAuctionAdvanced auction = new FairdropAuctionAdvanced(
    ...,
    true,  // whitelist enabled
    false, // pro-rata disabled
    0      // no max allocation
);

// Add addresses
address[] memory whitelist = [addr1, addr2, addr3];
auction.addToWhitelist(whitelist);
```

### Pro-Rata Allocation

When auction is oversold, tokens are distributed proportionally:

```solidity
FairdropAuctionAdvanced auction = new FairdropAuctionAdvanced(
    ...,
    false, // whitelist disabled
    true,  // pro-rata enabled
    0
);

// Example:
// Total supply: 1000 tokens
// Total bids: 1500 tokens
// User bid: 150 tokens
// User receives: 150 * 1000 / 1500 = 100 tokens
// User refund: (150 - 100) * clearingPrice
```

## Gas Optimizations

Our implementation includes production-grade optimizations:

1. **Packed Storage**
   ```solidity
   struct ParticipantInfo {
       uint128 quantity;    // 16 bytes
       uint128 amountPaid;  // 16 bytes
   }  // Total: 1 storage slot instead of 2
   ```

2. **Unchecked Math**
   ```solidity
   unchecked {
       // Safe: startPrice always >= floorPrice
       return startPrice - reduction;
   }
   ```

3. **Custom Reentrancy Guard**
   ```solidity
   uint8 private locked;  // 1 byte vs OpenZeppelin's 32
   ```

4. **Optimized Events**
   - Indexed parameters for efficient filtering
   - Minimal data in event payloads

## Security

- ✅ Reentrancy protection on all external calls
- ✅ Access control for admin functions
- ✅ Input validation on all parameters
- ✅ Safe math with overflow checks
- ✅ Emergency withdrawal functions
- ✅ Follows CEI (Checks-Effects-Interactions) pattern

## Project Structure

```
fairdrop-evm/
├── contracts/
│   ├── FairdropAuction.sol           # Main auction (Stages 1-3)
│   ├── FairdropAuctionAdvanced.sol   # Advanced features (Stage 5)
│   ├── FairdropAuctionFactory.sol    # Factory (Stage 4)
│   ├── interfaces/
│   │   └── IERC20.sol
│   └── mocks/
│       └── MockERC20.sol
├── test/
│   ├── FairdropAuction.test.ts
│   └── FairdropAuctionFactory.test.ts
├── scripts/
│   └── deploy.ts
├── FAIRDROP.md                       # Whitepaper
└── README.md                         # This file
```

## Configuration

### Hardhat Config

The project uses:
- Solidity 0.8.28
- Optimizer enabled (200 runs)
- IR compilation (viaIR) for complex functions
- Viem for testing

### Network Setup

Configure networks in `hardhat.config.ts`:

```typescript
networks: {
  sepolia: {
    type: "http",
    chainType: "l1",
    url: configVariable("SEPOLIA_RPC_URL"),
    accounts: [configVariable("SEPOLIA_PRIVATE_KEY")],
  },
}
```

## Testing

Comprehensive test coverage includes:

- ✅ Deployment and initialization
- ✅ Price calculation over time
- ✅ Single and multiple bids
- ✅ Bid validation and edge cases
- ✅ Auction finalization
- ✅ Token claiming and refunds
- ✅ Owner withdrawal functions
- ✅ Factory operations
- ✅ Access control
- ✅ Error handling

Run with:
```bash
npx hardhat test
```

## Deployment Checklist

- [ ] Audit contracts (recommended for production)
- [ ] Configure platform fee (1-3%)
- [ ] Set fee recipient address
- [ ] Deploy factory contract
- [ ] Verify contracts on block explorer
- [ ] Test auction creation
- [ ] Document auction parameters for users

## Roadmap

Future enhancements (beyond current implementation):

- [ ] NFT auction support (ERC721/ERC1155)
- [ ] Analytics dashboard
- [ ] Multi-signature admin control
- [ ] Upgradeable proxy pattern
- [ ] Cross-chain deployment
- [ ] Governance token integration

## Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Add tests for new features
4. Ensure all tests pass
5. Submit a pull request

## License

MIT License - see LICENSE file

## Support

- Email: xpldevelopers@gmail.com
- Website: www.fairdrop.io (coming soon)
- Issues: [GitHub Issues](https://github.com/wisdomabioye/fairdrop-evm/issues)

## Acknowledgments

Built following the Fairdrop whitepaper (2025 Edition)

---

**⚠️ Disclaimer**: This software is provided as-is. Always audit smart contracts before deploying to mainnet with real funds.
