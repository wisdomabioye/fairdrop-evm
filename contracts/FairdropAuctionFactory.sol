// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "./FairdropAuction.sol";

/**
 * @title FairdropAuctionFactory
 * @notice Factory contract for deploying new Fairdrop auction instances
 * @dev Implements Stage 4 - per-auction contract deployment pattern
 */
contract FairdropAuctionFactory {

    // ============ State Variables ============

    address public admin;
    uint256 public platformFeePercent; // Fee in basis points (e.g., 100 = 1%)
    address public feeRecipient;

    // Array of all created auctions
    address[] public allAuctions;

    // Mapping from auction ID to auction address
    mapping(uint256 => address) public auctions;

    // Mapping from owner to their created auctions
    mapping(address => address[]) public auctionsByOwner;

    // Auction counter
    uint256 public auctionCount;

    // ============ Events ============

    event AuctionCreated(
        uint256 indexed auctionId,
        address indexed auctionAddress,
        address indexed owner,
        address auctionToken,
        address paymentToken,
        uint256 startPrice,
        uint256 floorPrice,
        uint256 totalSupply
    );

    event FeeUpdated(uint256 oldFee, uint256 newFee);
    event FeeRecipientUpdated(address oldRecipient, address newRecipient);
    event AdminTransferred(address indexed previousAdmin, address indexed newAdmin);

    // ============ Errors ============

    error Unauthorized(string message);
    error InvalidFee(string message);
    error InvalidAddress(string message);
    error AuctionDoesNotExist(string message);

    // ============ Modifiers ============

    modifier onlyAdmin() {
        if (msg.sender != admin) revert Unauthorized("Only admin can call this function");
        _;
    }

    // ============ Constructor ============

    /**
     * @notice Initialize the factory
     * @param _platformFeePercent Initial platform fee (in basis points, 100 = 1%)
     * @param _feeRecipient Address to receive platform fees
     */
    constructor(uint256 _platformFeePercent, address _feeRecipient) {
        if (_platformFeePercent < 100 || _platformFeePercent > 300) revert InvalidFee("Fee must be between 1% and 3% (100-300 basis points)");
        if (_feeRecipient == address(0)) revert InvalidAddress("Fee recipient cannot be zero address");

        admin = msg.sender;
        platformFeePercent = _platformFeePercent;
        feeRecipient = _feeRecipient;
    }

    // ============ Core Functions ============

    /**
     * @notice Create a new Fairdrop auction
     * @param _startPrice Initial price per token
     * @param _floorPrice Minimum price per token
     * @param _priceDecrement Amount to decrease price each interval
     * @param _priceInterval Time between price decreases (in seconds)
     * @param _totalSupply Total tokens available for auction
     * @param _duration Total auction duration (in seconds)
     * @param _auctionToken Address of token being auctioned
     * @param _paymentToken Address of payment token (address(0) for ETH)
     * @return auctionAddress Address of the newly created auction
     */
    function createAuction(
        uint256 _startPrice,
        uint256 _floorPrice,
        uint256 _priceDecrement,
        uint256 _priceInterval,
        uint256 _totalSupply,
        uint256 _duration,
        address _auctionToken,
        address _paymentToken
    ) external returns (address auctionAddress) {
        // Deploy new auction contract
        FairdropAuction auction = new FairdropAuction(
            _startPrice,
            _floorPrice,
            _priceDecrement,
            _priceInterval,
            _totalSupply,
            _duration,
            _auctionToken,
            _paymentToken
        );

        auctionAddress = address(auction);

        // Store auction reference
        uint256 currentId = auctionCount;
        auctions[currentId] = auctionAddress;
        allAuctions.push(auctionAddress);
        auctionsByOwner[msg.sender].push(auctionAddress);

        unchecked {
            // Safe: would require 2^256 auctions to overflow
            auctionCount++;
        }

        emit AuctionCreated(
            currentId,
            auctionAddress,
            msg.sender,
            _auctionToken,
            _paymentToken,
            _startPrice,
            _floorPrice,
            _totalSupply
        );

        return auctionAddress;
    }

    // ============ View Functions ============

    /**
     * @notice Get all auctions created by a specific owner
     * @param owner Address of the auction owner
     * @return Array of auction addresses
     */
    function getAuctionsByOwner(address owner) external view returns (address[] memory) {
        return auctionsByOwner[owner];
    }

    /**
     * @notice Get total number of auctions created
     * @return Total auction count
     */
    function getTotalAuctions() external view returns (uint256) {
        return allAuctions.length;
    }

    /**
     * @notice Get auction address by ID
     * @param auctionId ID of the auction
     * @return Auction address
     */
    function getAuction(uint256 auctionId) external view returns (address) {
        if (auctionId >= auctionCount) revert AuctionDoesNotExist("Auction ID does not exist");
        return auctions[auctionId];
    }

    /**
     * @notice Get paginated list of all auctions
     * @param offset Starting index
     * @param limit Number of auctions to return
     * @return Slice of auction addresses
     */
    function getAuctionsPaginated(uint256 offset, uint256 limit)
        external
        view
        returns (address[] memory)
    {
        uint256 total = allAuctions.length;
        if (offset >= total) {
            return new address[](0);
        }

        uint256 end = offset + limit;
        if (end > total) {
            end = total;
        }

        uint256 size = end - offset;
        address[] memory result = new address[](size);

        for (uint256 i = 0; i < size; ) {
            result[i] = allAuctions[offset + i];
            unchecked {
                // Safe: i < size ensures no overflow
                ++i;
            }
        }

        return result;
    }

    /**
     * @notice Check if an address is a valid auction created by this factory
     * @param _auction Address to check
     * @return True if valid auction
     */
    function isValidAuction(address _auction) external view returns (bool) {
        for (uint256 i = 0; i < allAuctions.length; ) {
            if (allAuctions[i] == _auction) {
                return true;
            }
            unchecked {
                // Safe: i < allAuctions.length
                ++i;
            }
        }
        return false;
    }

    // ============ Admin Functions ============

    /**
     * @notice Update platform fee
     * @param _newFee New fee in basis points (100 = 1%)
     */
    function updatePlatformFee(uint256 _newFee) external onlyAdmin {
        if (_newFee < 100 || _newFee > 300) revert InvalidFee("Fee must be between 1% and 3% (100-300 basis points)");

        uint256 oldFee = platformFeePercent;
        platformFeePercent = _newFee;

        emit FeeUpdated(oldFee, _newFee);
    }

    /**
     * @notice Update fee recipient
     * @param _newRecipient New fee recipient address
     */
    function updateFeeRecipient(address _newRecipient) external onlyAdmin {
        if (_newRecipient == address(0)) revert InvalidAddress("Fee recipient cannot be zero address");

        address oldRecipient = feeRecipient;
        feeRecipient = _newRecipient;

        emit FeeRecipientUpdated(oldRecipient, _newRecipient);
    }

    /**
     * @notice Transfer admin role
     * @param _newAdmin New admin address
     */
    function transferAdmin(address _newAdmin) external onlyAdmin {
        if (_newAdmin == address(0)) revert InvalidAddress("Admin address cannot be zero address");

        address oldAdmin = admin;
        admin = _newAdmin;

        emit AdminTransferred(oldAdmin, _newAdmin);
    }
}
