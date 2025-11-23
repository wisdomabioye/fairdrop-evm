// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "./interfaces/IERC20.sol";

/**
 * @title FairdropAuctionAdvanced
 * @notice Advanced Dutch auction with whitelist and pro-rata allocation support
 * @dev Extends basic auction with Stage 5 features
 */
contract FairdropAuctionAdvanced {

    // ============ State Variables (Optimized Storage Layout) ============

    address public owner;
    AuctionStatus public status;
    bool public whitelistEnabled;
    bool public proRataEnabled;

    address public paymentToken;
    address public auctionToken;

    uint256 public startTime;
    uint256 public endTime;
    uint256 public startPrice;
    uint256 public floorPrice;
    uint256 public priceDecrement;
    uint256 public priceInterval;
    uint256 public totalSupply;
    uint256 public totalCommitted;
    uint256 public totalContributed;
    uint256 public clearingPrice;
    uint256 public maxAllocation; // Max tokens per participant (0 = no limit)

    uint8 private locked;

    mapping(address => ParticipantInfo) public participants;
    mapping(address => bool) public hasClaimed;
    mapping(address => bool) public whitelist;

    // ============ Structs ============

    struct ParticipantInfo {
        uint128 quantity;
        uint128 amountPaid;
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
        uint256 endTime,
        bool whitelistEnabled,
        bool proRataEnabled
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

    event WhitelistUpdated(address indexed user, bool status);
    event WhitelistEnabledToggled(bool enabled);
    event ProRataEnabledToggled(bool enabled);

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
    error NotWhitelisted();
    error ExceedsMaxAllocation();

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

    modifier onlyWhitelisted() {
        if (whitelistEnabled && !whitelist[msg.sender]) revert NotWhitelisted();
        _;
    }

    // ============ Constructor ============

    constructor(
        uint256 _startPrice,
        uint256 _floorPrice,
        uint256 _priceDecrement,
        uint256 _priceInterval,
        uint256 _totalSupply,
        uint256 _duration,
        address _auctionToken,
        address _paymentToken,
        bool _whitelistEnabled,
        bool _proRataEnabled,
        uint256 _maxAllocation
    ) {
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
        whitelistEnabled = _whitelistEnabled;
        proRataEnabled = _proRataEnabled;
        maxAllocation = _maxAllocation;

        startTime = block.timestamp;
        endTime = block.timestamp + _duration;
        status = AuctionStatus.Active;

        emit AuctionCreated(
            msg.sender,
            _startPrice,
            _floorPrice,
            _totalSupply,
            startTime,
            endTime,
            _whitelistEnabled,
            _proRataEnabled
        );
    }

    // ============ Core Functions ============

    function placeBid(uint256 quantity)
        external
        payable
        auctionActive
        nonReentrant
        onlyWhitelisted
    {
        if (quantity == 0) revert InvalidQuantity();

        // Get participant info
        ParticipantInfo storage participant = participants[msg.sender];

        // Check max allocation if set
        if (maxAllocation > 0) {
            uint256 newQuantity;
            unchecked {
                newQuantity = participant.quantity + quantity;
            }
            if (newQuantity > maxAllocation) revert ExceedsMaxAllocation();
        }

        uint256 currentPrice = getCurrentPrice();

        uint256 payment;
        unchecked {
            payment = currentPrice * quantity;
        }

        // If pro-rata is enabled, allow overbidding
        uint256 newTotalCommitted;
        unchecked {
            newTotalCommitted = totalCommitted + quantity;
        }

        if (!proRataEnabled && newTotalCommitted > totalSupply) {
            revert InsufficientSupply();
        }

        // Handle payment
        if (paymentToken == address(0)) {
            if (msg.value != payment) revert InvalidPrice();
        } else {
            if (msg.value != 0) revert InvalidParameters();
            bool success = IERC20(paymentToken).transferFrom(msg.sender, address(this), payment);
            if (!success) revert TransferFailed();
        }

        unchecked {
            participant.quantity += uint128(quantity);
            participant.amountPaid += uint128(payment);
        }

        // Update global state
        totalCommitted = newTotalCommitted;
        unchecked {
            totalContributed += payment;
        }

        emit BidPlaced(msg.sender, quantity, currentPrice, payment);
    }

    function getCurrentPrice() public view returns (uint256) {
        if (status != AuctionStatus.Active) {
            return clearingPrice > 0 ? clearingPrice : floorPrice;
        }

        if (block.timestamp < startTime) {
            return startPrice;
        }

        uint256 elapsed;
        unchecked {
            elapsed = block.timestamp - startTime;
        }

        uint256 intervals = elapsed / priceInterval;

        uint256 reduction;
        unchecked {
            reduction = intervals * priceDecrement;
        }

        if (reduction >= startPrice - floorPrice) {
            return floorPrice;
        }

        unchecked {
            return startPrice - reduction;
        }
    }

    function finalizeAuction() external {
        if (status != AuctionStatus.Active) revert AuctionAlreadyFinalized();
        if (block.timestamp < endTime) revert AuctionNotFinalized();

        status = AuctionStatus.Finalized;
        clearingPrice = getCurrentPrice();

        emit AuctionFinalized(clearingPrice, totalCommitted, totalContributed);
    }

    function claim() external nonReentrant {
        if (status != AuctionStatus.Finalized) revert AuctionNotFinalized();
        if (hasClaimed[msg.sender]) revert AlreadyClaimed();

        ParticipantInfo storage participant = participants[msg.sender];

        if (participant.quantity == 0) revert NothingToClaim();

        hasClaimed[msg.sender] = true;

        uint256 tokensToReceive = participant.quantity;
        uint256 amountPaid = participant.amountPaid;

        // Calculate pro-rata allocation if enabled and oversold
        if (proRataEnabled && totalCommitted > totalSupply) {
            // Calculate proportional allocation
            // tokensToReceive = (participant.quantity * totalSupply) / totalCommitted
            tokensToReceive = (participant.quantity * totalSupply) / totalCommitted;
        }

        // Calculate clearing cost and refund
        uint256 clearingCost;
        unchecked {
            clearingCost = clearingPrice * tokensToReceive;
        }

        uint256 refund;
        unchecked {
            refund = amountPaid - clearingCost;
        }

        emit TokensClaimed(msg.sender, tokensToReceive, refund);

        // Transfer auction tokens to participant
        if (tokensToReceive > 0) {
            bool tokenSuccess = IERC20(auctionToken).transfer(msg.sender, tokensToReceive);
            if (!tokenSuccess) revert TransferFailed();
        }

        // Refund overpayment if any
        if (refund > 0) {
            if (paymentToken == address(0)) {
                (bool refundSuccess, ) = msg.sender.call{value: refund}("");
                if (!refundSuccess) revert TransferFailed();
            } else {
                bool refundSuccess = IERC20(paymentToken).transfer(msg.sender, refund);
                if (!refundSuccess) revert TransferFailed();
            }
        }
    }

    // ============ Whitelist Management ============

    function addToWhitelist(address[] calldata users) external onlyOwner {
        for (uint256 i = 0; i < users.length; ) {
            whitelist[users[i]] = true;
            emit WhitelistUpdated(users[i], true);
            unchecked {
                ++i;
            }
        }
    }

    function removeFromWhitelist(address[] calldata users) external onlyOwner {
        for (uint256 i = 0; i < users.length; ) {
            whitelist[users[i]] = false;
            emit WhitelistUpdated(users[i], false);
            unchecked {
                ++i;
            }
        }
    }

    function toggleWhitelist(bool _enabled) external onlyOwner {
        whitelistEnabled = _enabled;
        emit WhitelistEnabledToggled(_enabled);
    }

    function toggleProRata(bool _enabled) external onlyOwner {
        if (totalCommitted > 0) revert AuctionAlreadyStarted();
        proRataEnabled = _enabled;
        emit ProRataEnabledToggled(_enabled);
    }

    // ============ View Functions ============

    function getParticipantInfo(address participant)
        external
        view
        returns (uint256 quantity, uint256 amountPaid)
    {
        ParticipantInfo memory info = participants[participant];
        return (info.quantity, info.amountPaid);
    }

    function isActive() external view returns (bool) {
        return status == AuctionStatus.Active
            && block.timestamp >= startTime
            && block.timestamp <= endTime;
    }

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
            _remainingSupply = totalSupply > totalCommitted
                ? totalSupply - totalCommitted
                : 0;

            _timeRemaining = block.timestamp >= endTime ? 0 : endTime - block.timestamp;
        }
    }

    function getExpectedRefund(address participant) external view returns (uint256) {
        ParticipantInfo memory info = participants[participant];

        if (info.quantity == 0) return 0;

        uint256 price = status == AuctionStatus.Finalized ? clearingPrice : getCurrentPrice();

        uint256 tokensToReceive = info.quantity;

        // Adjust for pro-rata if oversold
        if (proRataEnabled && totalCommitted > totalSupply) {
            tokensToReceive = (info.quantity * totalSupply) / totalCommitted;
        }

        uint256 expectedCost;
        unchecked {
            expectedCost = price * tokensToReceive;
        }

        if (info.amountPaid <= expectedCost) return 0;

        unchecked {
            return info.amountPaid - expectedCost;
        }
    }

    // ============ Admin Functions ============

    function cancelAuction() external onlyOwner {
        if (totalCommitted > 0) revert AuctionAlreadyStarted();

        status = AuctionStatus.Cancelled;

        emit AuctionCancelled(block.timestamp);
    }

    function withdrawProceeds() external onlyOwner nonReentrant {
        if (status != AuctionStatus.Finalized) revert AuctionNotFinalized();

        uint256 soldTokens = totalCommitted > totalSupply ? totalSupply : totalCommitted;

        uint256 proceeds;
        unchecked {
            proceeds = clearingPrice * soldTokens;
        }

        if (proceeds == 0) return;

        if (paymentToken == address(0)) {
            (bool success, ) = owner.call{value: proceeds}("");
            if (!success) revert TransferFailed();
        } else {
            bool success = IERC20(paymentToken).transfer(owner, proceeds);
            if (!success) revert TransferFailed();
        }
    }

    function withdrawUnsoldTokens() external onlyOwner nonReentrant {
        if (status != AuctionStatus.Finalized) revert AuctionNotFinalized();

        uint256 soldTokens = totalCommitted > totalSupply ? totalSupply : totalCommitted;

        uint256 unsold;
        unchecked {
            unsold = totalSupply - soldTokens;
        }

        if (unsold == 0) return;

        bool success = IERC20(auctionToken).transfer(owner, unsold);
        if (!success) revert TransferFailed();
    }

    function emergencyWithdraw() external onlyOwner nonReentrant {
        if (status != AuctionStatus.Cancelled) revert Unauthorized();

        uint256 balance = IERC20(auctionToken).balanceOf(address(this));
        if (balance > 0) {
            bool success = IERC20(auctionToken).transfer(owner, balance);
            if (!success) revert TransferFailed();
        }
    }
}
