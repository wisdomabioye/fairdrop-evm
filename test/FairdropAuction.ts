import { expect } from "chai";
import { getAddress } from "viem";
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";
import hre from "hardhat";

const { viem, networkHelpers } = await hre.network.connect();

describe("FairdropAuction", function () {
  let auction: any;
  let auctionToken: any;
  let paymentToken: any;
  let owner: any;
  let user1: any;
  let user2: any;
  let user3: any;

  const INITIAL_SUPPLY = 1_000_000n * 10n ** 18n;
  const AUCTION_SUPPLY = 100_000n * 10n ** 18n;
  const START_PRICE = 10n ** 18n; // 1 token
  const FLOOR_PRICE = 10n ** 17n; // 0.1 token
  const PRICE_DECREMENT = 10n ** 16n; // 0.01 token
  const PRICE_INTERVAL = 60n; // 60 seconds
  const AUCTION_DURATION = 3600n; // 1 hour

  beforeEach(async function () {
    [owner, user1, user2, user3] = await viem.getWalletClients();

    // Deploy mock tokens
    const MockERC20 = await viem.deployContract("MockERC20", [
      "Auction Token",
      "AUCT",
      INITIAL_SUPPLY,
    ]);
    auctionToken = MockERC20;

    const PaymentToken = await viem.deployContract("MockERC20", [
      "Payment Token",
      "PAY",
      INITIAL_SUPPLY,
    ]);
    paymentToken = PaymentToken;

    // Deploy auction
    const Auction = await viem.deployContract("FairdropAuction", [
      START_PRICE,
      FLOOR_PRICE,
      PRICE_DECREMENT,
      PRICE_INTERVAL,
      AUCTION_SUPPLY,
      AUCTION_DURATION,
      auctionToken.address,
      paymentToken.address,
    ]);
    auction = Auction;

    // Transfer auction tokens to auction contract
    await auctionToken.write.transfer([auction.address, AUCTION_SUPPLY]);

    // Mint payment tokens directly to users instead of transferring
    await paymentToken.write.mint([user1.account.address, 10_000n * 10n ** 18n]);
    await paymentToken.write.mint([user2.account.address, 10_000n * 10n ** 18n]);
    await paymentToken.write.mint([user3.account.address, 10_000n * 10n ** 18n]);
  });

  describe("Deployment", function () {
    it("Should set the correct owner", async function () {
      expect(getAddress(await auction.read.owner())).to.equal(
        getAddress(owner.account.address)
      );
    });

    it("Should set the correct auction parameters", async function () {
      expect(await auction.read.startPrice()).to.equal(START_PRICE);
      expect(await auction.read.floorPrice()).to.equal(FLOOR_PRICE);
      expect(await auction.read.priceDecrement()).to.equal(PRICE_DECREMENT);
      expect(await auction.read.priceInterval()).to.equal(PRICE_INTERVAL);
      expect(await auction.read.totalSupply()).to.equal(AUCTION_SUPPLY);
    });

    it("Should be in Active status", async function () {
      expect(await auction.read.status()).to.equal(1); // Active
    });
  });

  describe("Price Calculation", function () {
    it("Should return start price at auction start", async function () {
      const currentPrice = await auction.read.getCurrentPrice();
      expect(currentPrice).to.equal(START_PRICE);
    });

    it("Should decrease price over time", async function () {
      await networkHelpers.time.increase(Number(PRICE_INTERVAL));

      const expectedPrice = START_PRICE - PRICE_DECREMENT;
      const currentPrice = await auction.read.getCurrentPrice();

      expect(currentPrice).to.equal(expectedPrice);
    });

    it("Should not go below floor price", async function () {
      // Fast forward to end of auction
      await networkHelpers.time.increase(Number(AUCTION_DURATION) + 1);

      const currentPrice = await auction.read.getCurrentPrice();
      expect(currentPrice).to.be.gte(Number(FLOOR_PRICE));
    });

    it("Should calculate price correctly after multiple intervals", async function () {
      const intervals = 5n;
      await networkHelpers.time.increase(Number(PRICE_INTERVAL * intervals));

      const expectedPrice = START_PRICE - (PRICE_DECREMENT * intervals);
      const currentPrice = await auction.read.getCurrentPrice();

      expect(currentPrice).to.equal(expectedPrice);
    });
  });

  describe("Bidding", function () {
    it("Should allow user to place bid", async function () {
      const quantity = 1000n * 10n ** 18n;
      const currentPrice = await auction.read.getCurrentPrice();
      const payment = quantity * currentPrice / 10n ** 18n;

      // Approve payment token
      await paymentToken.write.approve([auction.address, payment], {
        account: user1.account,
      });

      // Place bid
      await auction.write.placeBid([quantity], {
        account: user1.account,
      });

      // Check participant info
      const [userQuantity, userPaid] = await auction.read.getParticipantInfo([
        user1.account.address,
      ]);

      expect(userQuantity).to.equal(quantity);
      expect(userPaid).to.equal(payment);
    });

    it("Should update total committed after bid", async function () {
      const quantity = 1000n * 10n ** 18n;
      const currentPrice = await auction.read.getCurrentPrice();
      const payment = quantity * currentPrice / 10n ** 18n;

      await paymentToken.write.approve([auction.address, payment], {
        account: user1.account,
      });

      await auction.write.placeBid([quantity], {
        account: user1.account,
      });

      expect(await auction.read.totalCommitted()).to.equal(quantity);
    });

    it("Should allow multiple bids from same user", async function () {
      const quantity1 = 500n * 10n ** 18n;
      const quantity2 = 300n * 10n ** 18n;

      const price1 = await auction.read.getCurrentPrice();
      const payment1 = quantity1 * price1 / 10n ** 18n;

      await paymentToken.write.approve([auction.address, payment1], {
        account: user1.account,
      });

      await auction.write.placeBid([quantity1], {
        account: user1.account,
      });

      // Wait for price to decrease
      await networkHelpers.time.increase(Number(PRICE_INTERVAL));

      const price2 = await auction.read.getCurrentPrice();
      const payment2 = quantity2 * price2 / 10n ** 18n;

      await paymentToken.write.approve([auction.address, payment2], {
        account: user1.account,
      });

      await auction.write.placeBid([quantity2], {
        account: user1.account,
      });

      const [userQuantity] = await auction.read.getParticipantInfo([
        user1.account.address,
      ]);

      expect(userQuantity).to.equal(quantity1 + quantity2);
    });

    it("Should allow multiple users to bid", async function () {
      const quantity = 1000n * 10n ** 18n;
      const currentPrice = await auction.read.getCurrentPrice();
      const payment = quantity * currentPrice / 10n ** 18n;

      // User1 bids
      await paymentToken.write.approve([auction.address, payment], {
        account: user1.account,
      });
      await auction.write.placeBid([quantity], {
        account: user1.account,
      });

      // User2 bids
      await paymentToken.write.approve([auction.address, payment], {
        account: user2.account,
      });
      await auction.write.placeBid([quantity], {
        account: user2.account,
      });

      expect(await auction.read.totalCommitted()).to.equal(quantity * 2n);
    });

    it("Should reject bid with zero quantity", async function () {
      await assert.rejects(async () => {
        await auction.write.placeBid([0n], { account: user1.account });
      });
    });

    it("Should reject bid exceeding supply", async function () {
      const excessiveQuantity = AUCTION_SUPPLY + 1n;
      const currentPrice = await auction.read.getCurrentPrice();
      const payment = excessiveQuantity * currentPrice / 10n ** 18n;

      await paymentToken.write.approve([auction.address, payment], {
        account: user1.account,
      });

      await assert.rejects(async () => {
        await auction.write.placeBid([excessiveQuantity], { account: user1.account });
      });
    });
  });

  describe("Finalization", function () {
    beforeEach(async function () {
      // Place some bids
      const quantity = 10_000n * 10n ** 18n;
      const currentPrice = await auction.read.getCurrentPrice();
      const payment = quantity * currentPrice / 10n ** 18n;

      await paymentToken.write.approve([auction.address, payment], {
        account: user1.account,
      });

      await auction.write.placeBid([quantity], {
        account: user1.account,
      });
    });

    it("Should not allow finalization before auction ends", async function () {
      await assert.rejects(async () => {
        await auction.write.finalizeAuction();
      });
    });

    it("Should allow finalization after auction ends", async function () {
      await networkHelpers.time.increase(Number(AUCTION_DURATION) + 1);

      await auction.write.finalizeAuction();

      expect(await auction.read.status()).to.equal(2); // Finalized
    });

    it("Should set clearing price correctly", async function () {
      await networkHelpers.time.increase(Number(AUCTION_DURATION) + 1);

      const priceBeforeFinalization = await auction.read.getCurrentPrice();

      await auction.write.finalizeAuction();

      const clearingPrice = await auction.read.clearingPrice();
      expect(clearingPrice).to.equal(priceBeforeFinalization);
    });
  });

  describe("Claiming", function () {
    beforeEach(async function () {
      // Place bid and finalize auction
      const quantity = 10_000n * 10n ** 18n;
      const currentPrice = await auction.read.getCurrentPrice();
      const payment = quantity * currentPrice / 10n ** 18n;

      await paymentToken.write.approve([auction.address, payment], {
        account: user1.account,
      });

      await auction.write.placeBid([quantity], {
        account: user1.account,
      });

      // Fast forward and finalize
      await networkHelpers.time.increase(Number(AUCTION_DURATION) + 1);
      await auction.write.finalizeAuction();
    });

    it("Should not allow claim before finalization", async function () {
      // Deploy new auction
      const newAuction = await viem.deployContract("FairdropAuction", [
        START_PRICE,
        FLOOR_PRICE,
        PRICE_DECREMENT,
        PRICE_INTERVAL,
        AUCTION_SUPPLY,
        AUCTION_DURATION,
        auctionToken.address,
        paymentToken.address,
      ]);

      await assert.rejects(async () => {
        await newAuction.write.claim({ account: user1.account });
      });
    });

    it("Should allow participant to claim tokens", async function () {
      const balanceBefore = await auctionToken.read.balanceOf([
        user1.account.address,
      ]);

      await auction.write.claim({ account: user1.account });

      const balanceAfter = await auctionToken.read.balanceOf([
        user1.account.address,
      ]);

      expect(balanceAfter).to.be.gt(balanceBefore);
    });

    it("Should calculate refund correctly", async function () {
      const paymentBalanceBefore = await paymentToken.read.balanceOf([
        user1.account.address,
      ]);

      await auction.write.claim({ account: user1.account });

      const paymentBalanceAfter = await paymentToken.read.balanceOf([
        user1.account.address,
      ]);

      // User should receive refund (paid at higher price, clearing at lower)
      expect(paymentBalanceAfter).to.be.gt(paymentBalanceBefore);
    });

    it("Should prevent double claiming", async function () {
      await auction.write.claim({ account: user1.account });

      await assert.rejects(async () => {
        await auction.write.claim({ account: user1.account });
      });
    });
  });

  describe("Admin Functions", function () {
    it("Should allow owner to withdraw proceeds", async function () {
      // Place bid and finalize
      const quantity = 10_000n * 10n ** 18n;
      const currentPrice = await auction.read.getCurrentPrice();
      const payment = quantity * currentPrice / 10n ** 18n;

      await paymentToken.write.approve([auction.address, payment], {
        account: user1.account,
      });

      await auction.write.placeBid([quantity], {
        account: user1.account,
      });

      await networkHelpers.time.increase(Number(AUCTION_DURATION) + 1);
      await auction.write.finalizeAuction();

      const balanceBefore = await paymentToken.read.balanceOf([
        owner.account.address,
      ]);

      await auction.write.withdrawProceeds();

      const balanceAfter = await paymentToken.read.balanceOf([
        owner.account.address,
      ]);

      expect(balanceAfter).to.be.gt(balanceBefore);
    });

    it("Should allow owner to withdraw unsold tokens", async function () {
      // Place small bid and finalize
      const quantity = 1_000n * 10n ** 18n;
      const currentPrice = await auction.read.getCurrentPrice();
      const payment = quantity * currentPrice / 10n ** 18n;

      await paymentToken.write.approve([auction.address, payment], {
        account: user1.account,
      });

      await auction.write.placeBid([quantity], {
        account: user1.account,
      });

      await networkHelpers.time.increase(Number(AUCTION_DURATION) + 1);
      await auction.write.finalizeAuction();

      const balanceBefore = await auctionToken.read.balanceOf([
        owner.account.address,
      ]);

      await auction.write.withdrawUnsoldTokens();

      const balanceAfter = await auctionToken.read.balanceOf([
        owner.account.address,
      ]);

      expect(balanceAfter).to.be.gt(balanceBefore);
    });

    it("Should allow owner to cancel auction before bids", async function () {
      const newAuction = await viem.deployContract("FairdropAuction", [
        START_PRICE,
        FLOOR_PRICE,
        PRICE_DECREMENT,
        PRICE_INTERVAL,
        AUCTION_SUPPLY,
        AUCTION_DURATION,
        auctionToken.address,
        paymentToken.address,
      ]);

      await newAuction.write.cancelAuction();

      expect(await newAuction.read.status()).to.equal(3); // Cancelled
    });

    it("Should not allow non-owner to withdraw proceeds", async function () {
      await assert.rejects(async () => {
        await auction.write.withdrawProceeds({ account: user1.account });
      });
    });
  });
});
