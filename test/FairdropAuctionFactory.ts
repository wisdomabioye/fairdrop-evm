import { expect } from "chai";
import { getAddress } from "viem";
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";
import hre from "hardhat";

const { viem } = await hre.network.connect();

describe("FairdropAuctionFactory", function () {
  let factory: any;
  let auctionToken: any;
  let paymentToken: any;
  let admin: any;
  let feeRecipient: any;
  let user1: any;

  const PLATFORM_FEE = 100n; // 1%
  const INITIAL_SUPPLY = 1_000_000n * 10n ** 18n;
  const AUCTION_SUPPLY = 100_000n * 10n ** 18n;
  const START_PRICE = 10n ** 18n;
  const FLOOR_PRICE = 10n ** 17n;
  const PRICE_DECREMENT = 10n ** 16n;
  const PRICE_INTERVAL = 60n;
  const AUCTION_DURATION = 3600n;

  beforeEach(async function () {
    [admin, feeRecipient, user1] = await viem.getWalletClients();

    // Deploy factory
    const Factory = await viem.deployContract("FairdropAuctionFactory", [
      PLATFORM_FEE,
      feeRecipient.account.address,
    ]);
    factory = Factory;

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
  });

  describe("Deployment", function () {
    it("Should set the correct admin", async function () {
      expect(getAddress(await factory.read.admin())).to.equal(
        getAddress(admin.account.address)
      );
    });

    it("Should set the correct platform fee", async function () {
      expect(await factory.read.platformFeePercent()).to.equal(PLATFORM_FEE);
    });

    it("Should set the correct fee recipient", async function () {
      expect(getAddress(await factory.read.feeRecipient())).to.equal(
        getAddress(feeRecipient.account.address)
      );
    });

    it("Should reject fee below 1%", async function () {
      await assert.rejects(
        async () => {
          await viem.deployContract("FairdropAuctionFactory", [
            50n, // 0.5%
            feeRecipient.account.address,
          ]);
        }
      );
    });

    it("Should reject fee above 3%", async function () {
      await assert.rejects(
        async () => {
          await viem.deployContract("FairdropAuctionFactory", [
            400n, // 4%
            feeRecipient.account.address,
          ]);
        }
      );
    });

    it("Should reject zero address as fee recipient", async function () {
      await assert.rejects(
        async () => {
          await viem.deployContract("FairdropAuctionFactory", [
            PLATFORM_FEE,
            "0x0000000000000000000000000000000000000000",
          ]);
        }
      );
    });
  });

  describe("Auction Creation", function () {
    it("Should create a new auction", async function () {
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

      expect(await factory.read.auctionCount()).to.equal(1n);
    });

    it("Should increment auction count", async function () {
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

      expect(await factory.read.auctionCount()).to.equal(2n);
    });

    it("Should track auctions by owner", async function () {
      await factory.write.createAuction(
        [
          START_PRICE,
          FLOOR_PRICE,
          PRICE_DECREMENT,
          PRICE_INTERVAL,
          AUCTION_SUPPLY,
          AUCTION_DURATION,
          auctionToken.address,
          paymentToken.address,
        ],
        { account: user1.account }
      );

      const userAuctions = await factory.read.getAuctionsByOwner([
        user1.account.address,
      ]);

      expect(userAuctions.length).to.equal(1);
    });

    it("Should return correct total auctions", async function () {
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

      expect(await factory.read.getTotalAuctions()).to.equal(2n);
    });
  });

  describe("Auction Retrieval", function () {
    beforeEach(async function () {
      // Create some auctions
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
    });

    it("Should get auction by ID", async function () {
      const auctionAddress = await factory.read.getAuction([0n]);
      expect(auctionAddress).to.not.equal(
        "0x0000000000000000000000000000000000000000"
      );
    });

    it("Should reject invalid auction ID", async function () {
      await assert.rejects(async () => {
        await factory.read.getAuction([999n]);
      });
    });

    it("Should get paginated auctions", async function () {
      const auctions = await factory.read.getAuctionsPaginated([0n, 10n]);
      expect(auctions.length).to.equal(2);
    });

    it("Should handle pagination correctly", async function () {
      const firstPage = await factory.read.getAuctionsPaginated([0n, 1n]);
      const secondPage = await factory.read.getAuctionsPaginated([1n, 1n]);

      expect(firstPage.length).to.equal(1);
      expect(secondPage.length).to.equal(1);
      expect(firstPage[0]).to.not.equal(secondPage[0]);
    });

    it("Should validate auction addresses", async function () {
      const auctionAddress = await factory.read.getAuction([0n]);
      const isValid = await factory.read.isValidAuction([auctionAddress]);

      expect(isValid).to.be.true;
    });

    it("Should return false for invalid auction address", async function () {
      const isValid = await factory.read.isValidAuction([
        "0x0000000000000000000000000000000000000001",
      ]);

      expect(isValid).to.be.false;
    });
  });

  describe("Admin Functions", function () {
    it("Should allow admin to update platform fee", async function () {
      const newFee = 200n; // 2%

      await factory.write.updatePlatformFee([newFee]);

      expect(await factory.read.platformFeePercent()).to.equal(newFee);
    });

    it("Should reject fee update below 1%", async function () {
      await assert.rejects(async () => {
        await factory.write.updatePlatformFee([50n]);
      });
    });

    it("Should reject fee update above 3%", async function () {
      await assert.rejects(async () => {
        await factory.write.updatePlatformFee([400n]);
      });
    });

    it("Should allow admin to update fee recipient", async function () {
      const [, , newRecipient] = await viem.getWalletClients();

      await factory.write.updateFeeRecipient([newRecipient.account.address]);

      expect(getAddress(await factory.read.feeRecipient())).to.equal(
        getAddress(newRecipient.account.address)
      );
    });

    it("Should reject zero address as new fee recipient", async function () {
      await assert.rejects(async () => {
        await factory.write.updateFeeRecipient([
          "0x0000000000000000000000000000000000000000",
        ]);
      });
    });

    it("Should allow admin to transfer admin role", async function () {
      const [, , newAdmin] = await viem.getWalletClients();

      await factory.write.transferAdmin([newAdmin.account.address]);

      expect(getAddress(await factory.read.admin())).to.equal(
        getAddress(newAdmin.account.address)
      );
    });

    it("Should reject transfer to zero address", async function () {
      await assert.rejects(async () => {
        await factory.write.transferAdmin([
          "0x0000000000000000000000000000000000000000",
        ]);
      });
    });

    it("Should not allow non-admin to update fee", async function () {
      await assert.rejects(async () => {
        await factory.write.updatePlatformFee([200n], { account: user1.account });
      });
    });

    it("Should not allow non-admin to update fee recipient", async function () {
      await assert.rejects(async () => {
        await factory.write.updateFeeRecipient([user1.account.address], {
          account: user1.account,
        });
      });
    });

    it("Should not allow non-admin to transfer admin", async function () {
      await assert.rejects(async () => {
        await factory.write.transferAdmin([user1.account.address], {
          account: user1.account,
        });
      });
    });
  });
});
