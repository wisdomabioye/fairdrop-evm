// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "./interfaces/IERC20.sol";

/**
 * @title FairdropAuction
 * @notice A gas-optimized Dutch auction contract with descending price and uniform clearing
 * @dev Stage 1-3 implementation with payment integration and claiming mechanism
 */
contract FairdropAuction {

    // ============ State Variables (Optimized Storage Layout) ============

    // Slot 0: Auction owner (20 bytes) + auction status (1 byte) + hasStarted (1 byte)
    address public owner;
    AuctionStatus public status;
    bool private hasStarted;

    // Slot 1: Payment token address (20 bytes) + paymentTokenDecimals (1 byte) + auctionTokenDecimals (1 byte)
    address public paymentToken;
    uint8 public paymentTokenDecimals;
    uint8 public auctionTokenDecimals;

    // Slot 2: Auction token address (20 bytes)
    address public auctionToken;

    // Slot 3: Start time (32 bytes)
    uint256 public startTime;

    // Slot 4: End time (32 bytes)
    uint256 public endTime;

    // Slot 5: Start price (32 bytes)
    uint256 public startPrice;

    // Slot 6: Floor price (32 bytes)
    uint256 public floorPrice;

    // Slot 7: Price decrement per interval (32 bytes)
    uint256 public priceDecrement;

    // Slot 8: Time interval for price drops (32 bytes)
    uint256 public priceInterval;

    // Slot 9: Total supply of tokens to sell (32 bytes)
    uint256 public totalSupply;

    // Slot 10: Total tokens committed (32 bytes)
    uint256 public totalCommitted;

    // Slot 11: Total payment contributed (32 bytes)
    uint256 public totalContributed;

    // Slot 12: Clearing price (32 bytes)
    uint256 public clearingPrice;

    // Slot 13: Reentrancy lock (1 byte packed)
    uint8 private locked;

    // Mapping storage
    mapping(address => ParticipantInfo) public participants;
    mapping(address => bool) public hasClaimed;

    // ============ Structs ============

    /// @dev Packed struct to minimize storage (fits in 2 slots)
    struct ParticipantInfo {
        uint128 quantity;        // Amount of tokens committed (slot 0, 16 bytes)
        uint128 amountPaid;      // Amount of payment token paid (slot 0, 16 bytes)
    }

    // ============ Enums ============

    enum AuctionStatus {
        NotStarted,
        Active,
        Finalized,
        Cancelled
    }

    // ============ Events ============

    event AuctionCreated(
        address indexed owner,
        uint256 startPrice,
        uint256 floorPrice,
        uint256 totalSupply,
        uint256 startTime,
        uint256 endTime
    );

    event BidPlaced(
        address indexed participant,
        uint256 quantity,
        uint256 price,
        uint256 totalPaid
    );

    event AuctionFinalized(
        uint256 clearingPrice,
        uint256 totalCommitted,
        uint256 totalContributed
    );

    event TokensClaimed(
        address indexed participant,
        uint256 tokensReceived,
        uint256 refundAmount
    );

    event AuctionCancelled(uint256 timestamp);

    // ============ Errors ============

    error Unauthorized();
    error InvalidParameters();
    error AuctionNotActive();
    error AuctionAlreadyStarted();
    error AuctionNotFinalized();
    error AuctionAlreadyFinalized();
    error InsufficientSupply();
    error InvalidPrice();
    error InvalidQuantity();
    error AlreadyClaimed();
    error NothingToClaim();
    error TransferFailed();
    error ReentrancyGuard();

    // ============ Modifiers ============

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    modifier auctionActive() {
        if (status != AuctionStatus.Active) revert AuctionNotActive();
        if (block.timestamp < startTime || block.timestamp > endTime) revert AuctionNotActive();
        _;
    }

    modifier nonReentrant() {
        if (locked == 1) revert ReentrancyGuard();
        locked = 1;
        _;
        locked = 0;
    }

    // ============ Constructor ============

    /**
     * @notice Initialize a new Fairdrop auction
     * @param _startPrice Initial price per token
     * @param _floorPrice Minimum price per token
     * @param _priceDecrement Amount to decrease price each interval
     * @param _priceInterval Time between price decreases (in seconds)
     * @param _totalSupply Total tokens available for auction
     * @param _duration Total auction duration (in seconds)
     * @param _auctionToken Address of token being auctioned
     * @param _paymentToken Address of payment token (address(0) for ETH)
     */
    constructor(
        uint256 _startPrice,
        uint256 _floorPrice,
        uint256 _priceDecrement,
        uint256 _priceInterval,
        uint256 _totalSupply,
        uint256 _duration,
        address _auctionToken,
        address _paymentToken
    ) {
        // Validation
        if (_startPrice <= _floorPrice) revert InvalidParameters();
        if (_priceDecrement == 0) revert InvalidParameters();
        if (_priceInterval == 0) revert InvalidParameters();
        if (_totalSupply == 0) revert InvalidParameters();
        if (_duration == 0) revert InvalidParameters();
        if (_auctionToken == address(0)) revert InvalidParameters();

        owner = msg.sender;
        startPrice = _startPrice;
        floorPrice = _floorPrice;
        priceDecrement = _priceDecrement;
        priceInterval = _priceInterval;
        totalSupply = _totalSupply;
        auctionToken = _auctionToken;
        paymentToken = _paymentToken;

        // Fetch token decimals
        auctionTokenDecimals = IERC20(_auctionToken).decimals();
        paymentTokenDecimals = _paymentToken == address(0) ? 18 : IERC20(_paymentToken).decimals();

        // Auction starts immediately
        startTime = block.timestamp;
        endTime = block.timestamp + _duration;
        status = AuctionStatus.Active;
        hasStarted = true;

        emit AuctionCreated(
            msg.sender,
            _startPrice,
            _floorPrice,
            _totalSupply,
            startTime,
            endTime
        );
    }

    // ============ Core Functions ============

    /**
     * @notice Place a bid in the auction with payment
     * @param quantity Amount of tokens to purchase
     */
    function placeBid(uint256 quantity) external payable auctionActive nonReentrant {
        if (quantity == 0) revert InvalidQuantity();

        uint256 currentPrice = getCurrentPrice();

        // Calculate required payment
        // Formula: payment = (currentPrice * quantity) / (10 ** auctionTokenDecimals)
        // currentPrice is price per whole auction token in payment token units
        // quantity is in auction token base units
        uint256 payment;
        unchecked {
            // Safe: division prevents overflow
            payment = (currentPrice * quantity) / (10 ** auctionTokenDecimals);
        }

        // Check if there's enough supply
        uint256 newTotalCommitted;
        unchecked {
            // Safe: we check for overflow with totalSupply
            newTotalCommitted = totalCommitted + quantity;
        }
        if (newTotalCommitted > totalSupply) revert InsufficientSupply();

        // Handle payment (ETH or ERC20)
        if (paymentToken == address(0)) {
            // ETH payment
            if (msg.value != payment) revert InvalidPrice();
        } else {
            // ERC20 payment
            if (msg.value != 0) revert InvalidParameters();
            bool success = IERC20(paymentToken).transferFrom(msg.sender, address(this), payment);
            if (!success) revert TransferFailed();
        }

        // Update participant info
        ParticipantInfo storage participant = participants[msg.sender];

        unchecked {
            // Safe: overflow would require unrealistic token amounts
            participant.quantity += uint128(quantity);
            participant.amountPaid += uint128(payment);
        }

        // Update global state
        totalCommitted = newTotalCommitted;
        unchecked {
            // Safe: overflow would require unrealistic payment amounts
            totalContributed += payment;
        }

        emit BidPlaced(msg.sender, quantity, currentPrice, payment);
    }

    /**
     * @notice Calculate the current auction price based on elapsed time
     * @return Current price per token
     */
    function getCurrentPrice() public view returns (uint256) {
        if (status != AuctionStatus.Active) {
            return clearingPrice > 0 ? clearingPrice : floorPrice;
        }

        if (block.timestamp < startTime) {
            return startPrice;
        }

        // Calculate time elapsed
        uint256 elapsed;
        unchecked {
            // Safe: block.timestamp >= startTime due to check above
            elapsed = block.timestamp - startTime;
        }

        // Calculate number of intervals passed
        uint256 intervals = elapsed / priceInterval;

        // Calculate price reduction
        uint256 reduction;
        unchecked {
            // Safe: we check against startPrice below
            reduction = intervals * priceDecrement;
        }

        // Calculate current price, ensuring it doesn't go below floor
        if (reduction >= startPrice - floorPrice) {
            return floorPrice;
        }

        unchecked {
            // Safe: reduction < (startPrice - floorPrice) from check above
            return startPrice - reduction;
        }
    }

    /**
     * @notice Finalize the auction and set the clearing price
     * @dev Can be called by anyone after auction ends
     */
    function finalizeAuction() external {
        if (status != AuctionStatus.Active) revert AuctionAlreadyFinalized();
        if (block.timestamp < endTime) revert AuctionNotFinalized();

        // Set clearing price to current price at auction end (must be before changing status)
        clearingPrice = getCurrentPrice();

        status = AuctionStatus.Finalized;

        emit AuctionFinalized(clearingPrice, totalCommitted, totalContributed);
    }

    /**
     * @notice Claim tokens and refund after auction finalization
     * @dev Participants receive tokens at clearing price and refund for overpayment
     */
    function claim() external nonReentrant {
        if (status != AuctionStatus.Finalized) revert AuctionNotFinalized();
        if (hasClaimed[msg.sender]) revert AlreadyClaimed();

        ParticipantInfo storage participant = participants[msg.sender];

        if (participant.quantity == 0) revert NothingToClaim();

        hasClaimed[msg.sender] = true;

        uint256 tokensToReceive = participant.quantity;
        uint256 amountPaid = participant.amountPaid;

        // Calculate refund (difference between what was paid and clearing price)
        uint256 clearingCost;
        unchecked {
            // Safe: division prevents overflow
            clearingCost = (clearingPrice * tokensToReceive) / (10 ** auctionTokenDecimals);
        }

        uint256 refund;
        unchecked {
            // Safe: amountPaid >= clearingCost in a descending auction
            refund = amountPaid - clearingCost;
        }

        emit TokensClaimed(msg.sender, tokensToReceive, refund);

        // Transfer auction tokens to participant
        bool tokenSuccess = IERC20(auctionToken).transfer(msg.sender, tokensToReceive);
        if (!tokenSuccess) revert TransferFailed();

        // Refund overpayment if any
        if (refund > 0) {
            if (paymentToken == address(0)) {
                // ETH refund
                (bool refundSuccess, ) = msg.sender.call{value: refund}("");
                if (!refundSuccess) revert TransferFailed();
            } else {
                // ERC20 refund
                bool refundSuccess = IERC20(paymentToken).transfer(msg.sender, refund);
                if (!refundSuccess) revert TransferFailed();
            }
        }
    }

    // ============ View Functions ============

    /**
     * @notice Get participant information
     * @param participant Address of participant
     * @return quantity Tokens committed
     * @return amountPaid Total amount paid
     */
    function getParticipantInfo(address participant)
        external
        view
        returns (uint256 quantity, uint256 amountPaid)
    {
        ParticipantInfo memory info = participants[participant];
        return (info.quantity, info.amountPaid);
    }

    /**
     * @notice Check if auction is active
     * @return True if auction is active
     */
    function isActive() external view returns (bool) {
        return status == AuctionStatus.Active
            && block.timestamp >= startTime
            && block.timestamp <= endTime;
    }

    /**
     * @notice Get auction state summary
     * @return _status Current auction status
     * @return _currentPrice Current price per token
     * @return _totalCommitted Total tokens committed
     * @return _remainingSupply Remaining tokens available
     * @return _timeRemaining Seconds until auction ends
     */
    function getAuctionState()
        external
        view
        returns (
            AuctionStatus _status,
            uint256 _currentPrice,
            uint256 _totalCommitted,
            uint256 _remainingSupply,
            uint256 _timeRemaining
        )
    {
        _status = status;
        _currentPrice = getCurrentPrice();
        _totalCommitted = totalCommitted;

        unchecked {
            // Safe: totalSupply >= totalCommitted enforced in placeBid
            _remainingSupply = totalSupply - totalCommitted;

            // Safe: handle case where auction has ended
            _timeRemaining = block.timestamp >= endTime ? 0 : endTime - block.timestamp;
        }
    }

    /**
     * @notice Calculate expected refund for a participant
     * @param participant Address of participant
     * @return Expected refund amount if auction finalizes at current price
     */
    function getExpectedRefund(address participant) external view returns (uint256) {
        ParticipantInfo memory info = participants[participant];

        if (info.quantity == 0) return 0;

        uint256 price = status == AuctionStatus.Finalized ? clearingPrice : getCurrentPrice();

        uint256 expectedCost;
        unchecked {
            // Safe: division prevents overflow
            expectedCost = (price * info.quantity) / (10 ** auctionTokenDecimals);
        }

        if (info.amountPaid <= expectedCost) return 0;

        unchecked {
            // Safe: info.amountPaid > expectedCost from check above
            return info.amountPaid - expectedCost;
        }
    }

    /**
     * @notice Cancel auction (only owner, only before any bids)
     */
    function cancelAuction() external onlyOwner {
        if (totalCommitted > 0) revert AuctionAlreadyStarted();

        status = AuctionStatus.Cancelled;

        emit AuctionCancelled(block.timestamp);
    }

    /**
     * @notice Withdraw proceeds after auction finalization (owner only)
     * @dev Transfers total revenue (at clearing price) to owner
     */
    function withdrawProceeds() external onlyOwner nonReentrant {
        if (status != AuctionStatus.Finalized) revert AuctionNotFinalized();

        // Calculate total proceeds at clearing price
        uint256 proceeds;
        unchecked {
            // Safe: division prevents overflow
            proceeds = (clearingPrice * totalCommitted) / (10 ** auctionTokenDecimals);
        }

        if (proceeds == 0) return;

        // Transfer proceeds to owner
        if (paymentToken == address(0)) {
            // ETH proceeds
            (bool success, ) = owner.call{value: proceeds}("");
            if (!success) revert TransferFailed();
        } else {
            // ERC20 proceeds
            bool success = IERC20(paymentToken).transfer(owner, proceeds);
            if (!success) revert TransferFailed();
        }
    }

    /**
     * @notice Withdraw unsold auction tokens (owner only)
     * @dev Can be called after finalization to recover unsold tokens
     */
    function withdrawUnsoldTokens() external onlyOwner nonReentrant {
        if (status != AuctionStatus.Finalized) revert AuctionNotFinalized();

        uint256 unsold;
        unchecked {
            // Safe: totalSupply >= totalCommitted enforced in placeBid
            unsold = totalSupply - totalCommitted;
        }

        if (unsold == 0) return;

        bool success = IERC20(auctionToken).transfer(owner, unsold);
        if (!success) revert TransferFailed();
    }

    /**
     * @notice Emergency withdraw in case of cancelled auction
     * @dev Owner can recover auction tokens if auction is cancelled
     */
    function emergencyWithdraw() external onlyOwner nonReentrant {
        if (status != AuctionStatus.Cancelled) revert Unauthorized();

        uint256 balance = IERC20(auctionToken).balanceOf(address(this));
        if (balance > 0) {
            bool success = IERC20(auctionToken).transfer(owner, balance);
            if (!success) revert TransferFailed();
        }
    }
}
