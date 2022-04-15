pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import  "@openzeppelin/contracts/security/ReentrancyGuard.sol";

/// @title Pika token generation contract(adapted from Jones Dao token generation contract)
/// Phase 1: whitelisted address can get Pika with fixed price with a maximum ETH size per address
/// Phase 2: any address can contribute any amount of ETH. The final price of the phase is decided by
/// (total ETH contributed for this phase / total Pika tokens for this phase)
contract PikaTokenGeneration is ReentrancyGuard {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;

    // Pika Token
    IERC20 public pika;
    // Withdrawer
    address public owner;
    // Keeps track of ETH deposited during whitelist phase
    uint256 public weiDepositedWhitelist;
    // Keeps track of ETH deposited
    uint256 public weiDeposited;
    // Time when the token sale starts for whitelisted address
    uint256 public saleWhitelistStart;
    // Time when the token sale starts
    uint256 public saleStart;
    // Time when the token sale closes
    uint256 public saleClose;
    // Max cap on wei raised during whitelist
    uint256 public maxDepositsWhitelist;
    // Pika Tokens allocated to this contract
    uint256 public pikaTokensAllocated;
    // Pika Tokens allocated to whitelist
    uint256 public pikaTokensAllocatedWhitelist;
    // Max ETH that can be deposited by whitelisted addresses
    uint256 public maxWhitelistDepositPerAddress;
    // Merkleroot of whitelisted addresses
    bytes32 public merkleRoot;
    // Amount each whitelisted user deposited
    mapping(address => uint256) public depositsWhitelist;
    // Amount each user deposited
    mapping(address => uint256) public deposits;

    event TokenDeposit(
        address indexed purchaser,
        address indexed beneficiary,
        bool indexed isWhitelistDeposit,
        uint256 value,
        uint256 time
    );
    event TokenClaim(
        address indexed claimer,
        address indexed beneficiary,
        uint256 amount
    );
    event EthRefundClaim(
        address indexed claimer,
        address indexed beneficiary,
        uint256 amount
    );
    event WithdrawEth(uint256 amount);

    /// @param _pika Pika
    /// @param _owner withdrawer
    /// @param _saleWhitelistStart time when the token sale starts for whitelisted addresses
    /// @param _saleStart time when the token sale starts
    /// @param _saleClose time when the token sale closes
    /// @param _maxDepositsWhitelist max cap on wei raised during whitelist
    /// @param _pikaTokensAllocated Pika tokens allocated to this contract
    /// @param _maxWhitelistDeposit max deposit that can be done via the whitelist deposit fn
    /// @param _merkleRoot the merkle root of all the whitelisted addresses
    constructor(
        address _pika,
        address _owner,
        uint256 _saleWhitelistStart,
        uint256 _saleStart,
        uint256 _saleClose,
        uint256 _maxDepositsWhitelist,
        uint256 _pikaTokensAllocated,
        uint256 _maxWhitelistDepositPerAddress,
        bytes32 _merkleRoot
    ) {
        require(_owner != address(0), "invalid owner address");
        require(_pika != address(0), "invalid token address");
        require(saleWhitelistStart <= _saleStart, "invalid saleWhitelistStart");
        require(_saleStart >= block.timestamp, "invalid saleStart");
        require(_saleClose > _saleStart, "invalid saleClose");
        require(_maxDepositsWhitelist > 0, "invalid maxDepositsWhitelist");
        require(_pikaTokensAllocated > 0, "invalid pikaTokensAllocated");

        pika = IERC20(_pika);
        owner = _owner;
        saleWhitelistStart = _saleWhitelistStart;
        saleStart = _saleStart;
        saleClose = _saleClose;
        maxDepositsWhitelist = _maxDepositsWhitelist;
        pikaTokensAllocated = _pikaTokensAllocated;
        pikaTokensAllocatedWhitelist = pikaTokensAllocated.mul(60).div(100); // 60% of PikaTokensAllocated
        maxWhitelistDepositPerAddress = _maxWhitelistDepositPerAddress;
        merkleRoot = _merkleRoot;
    }

    /// Checks if a whitelisted address has already deposited using the whitelist deposit fn
    /// @param _user user address
    function isWhitelistedAddressDeposited(address _user) public view returns (bool) {
        return depositsWhitelist[_user] > 0;
    }

    /// Deposit fallback
    /// @dev must be equivalent to deposit(address beneficiary)
    receive() external payable isEligibleSender nonReentrant {
        address beneficiary = msg.sender;
        require(beneficiary != address(0), "invalid address");
        require(saleStart <= block.timestamp, "sale hasn't started yet");
        require(block.timestamp <= saleClose, "sale has closed");

        deposits[beneficiary] = deposits[beneficiary].add(msg.value);
        weiDeposited = weiDeposited.add(msg.value);
        emit TokenDeposit(
            msg.sender,
            beneficiary,
            false,
            msg.value,
            block.timestamp
        );
    }

    /// Deposit for whitelisted address
    /// @param index the index of the whitelisted address in the merkle tree
    /// @param beneficiary will be able to claim tokens after saleClose
    /// @param merkleProof the merkle proof
    function depositForWhitelistedAddress(
        uint256 index,
        address beneficiary,
        bytes32[] calldata merkleProof
    ) external payable nonReentrant {
        require(beneficiary != address(0), "invalid address");
        require(beneficiary == msg.sender, "beneficiary not message sender");
        require(msg.value > 0, "must deposit greater than 0");
        require(msg.value <= depositableLeftWhitelist(beneficiary), "user whitelist allocation used up");
        require((weiDepositedWhitelist + msg.value) <= maxDepositsWhitelist, "maximum deposits for whitelist reached");
        require(saleWhitelistStart <= block.timestamp, "sale hasn't started yet");
        require(block.timestamp <= saleStart, "whitelist sale has closed");

        // Verify the merkle proof.
        uint256 amt = 1;
        bytes32 node = keccak256(abi.encodePacked(index, beneficiary, amt));
        require(
            MerkleProof.verify(merkleProof, merkleRoot, node),
            "invalid proof"
        );

        // Add user deposit to depositsWhitelist
        depositsWhitelist[beneficiary] = depositsWhitelist[beneficiary].add(
            msg.value
        );

        weiDepositedWhitelist = weiDepositedWhitelist.add(msg.value);
        weiDeposited = weiDeposited.add(msg.value);

        emit TokenDeposit(
            msg.sender,
            beneficiary,
            true,
            msg.value,
            block.timestamp
        );
    }

    /// Deposit
    /// @param beneficiary will be able to claim tokens after saleClose
    /// @dev must be equivalent to receive()
    function deposit(address beneficiary) public payable isEligibleSender nonReentrant {
        require(beneficiary != address(0), "invalid address");
        require(saleStart <= block.timestamp, "sale hasn't started yet");
        require(block.timestamp <= saleClose, "sale has closed");

        deposits[beneficiary] = deposits[beneficiary].add(msg.value);
        weiDeposited = weiDeposited.add(msg.value);
        emit TokenDeposit(
            msg.sender,
            beneficiary,
            false,
            msg.value,
            block.timestamp
        );
    }

    /// Claim
    /// @param beneficiary receives the tokens they claimed
    /// @dev claim calculation must be equivalent to claimAmount(address beneficiary)
    function claim(address beneficiary) external nonReentrant returns (uint256) {
        require(
            deposits[beneficiary] + depositsWhitelist[beneficiary] > 0,
            "no deposit"
        );
        require(block.timestamp > saleClose, "sale hasn't closed yet");

        // total Pika allocated * user share in the ETH deposited
        uint256 beneficiaryClaim = claimAmountPika(beneficiary);
        depositsWhitelist[beneficiary] = 0;
        deposits[beneficiary] = 0;

        pika.safeTransfer(beneficiary, beneficiaryClaim);

        emit TokenClaim(msg.sender, beneficiary, beneficiaryClaim);

        return beneficiaryClaim;
    }

    /// @dev Withdraws eth deposited into the contract. Only owner can call this.
    function withdraw() external {
        require(owner == msg.sender, "caller is not the owner");
        uint256 ethBalance = payable(address(this)).balance;
        payable(msg.sender).transfer(ethBalance);

        emit WithdrawEth(ethBalance);
    }

    /// View beneficiary's claimable token amount
    /// @param beneficiary address to view claimable token amount of
    function claimAmountPika(address beneficiary) public view returns (uint256) {
        // wei deposited during whitelist sale by beneficiary
        uint256 userDepoWl = depositsWhitelist[beneficiary];

        // wei deposited during public sale by beneficiary
        uint256 userDepoPub = deposits[beneficiary];

        if (userDepoPub.add(userDepoWl) == 0) {
            return 0;
        }

        // amount of Pika unsold during whitelist sale
        uint256 unsoldWlPika = pikaTokensAllocatedWhitelist
        .mul((maxDepositsWhitelist.sub(weiDepositedWhitelist)))
        .div(maxDepositsWhitelist);

        // amount of Pika tokens allocated to whitelist sale
        uint256 pikaForWl = pikaTokensAllocatedWhitelist.sub(unsoldWlPika);

        // amount of Pika tokens allocated to public sale
        uint256 pikaForPublic = pikaTokensAllocated.sub(pikaForWl);

        // total wei deposited during the public sale
        uint256 totalDepoPublic = weiDeposited.sub(weiDepositedWhitelist);

        uint256 userClaimablePika = 0;

        if (userDepoWl > 0) {
            userClaimablePika = pikaForWl.mul(userDepoWl).div(weiDepositedWhitelist);
        }
        if (userDepoPub > 0) {
            userClaimablePika = userClaimablePika.add(pikaForPublic.mul(userDepoPub).div(totalDepoPublic));
        }
        return userClaimablePika;
    }

    /// View leftover depositable eth for whitelisted user
    /// @param beneficiary user address
    function depositableLeftWhitelist(address beneficiary) public view returns (uint256) {
        return maxWhitelistDepositPerAddress.sub(depositsWhitelist[beneficiary]);
    }

    function getCurrentPikaPrice() external view returns(uint256) {
        uint256 minPrice = maxDepositsWhitelist.div(pikaTokensAllocatedWhitelist).mul(1e18);
        if (block.timestamp <= saleStart) {
            return minPrice;
        }
        // amount of Pika unsold during whitelist sale
        uint256 unsoldWlPika = pikaTokensAllocatedWhitelist
        .mul((maxDepositsWhitelist.sub(weiDepositedWhitelist)))
        .div(maxDepositsWhitelist);

        // amount of Pika tokens allocated to whitelist sale
        uint256 pikaForWl = pikaTokensAllocatedWhitelist.sub(unsoldWlPika);

        // amount of Pika tokens allocated to public sale
        uint256 pikaForPublic = pikaTokensAllocated.sub(pikaForWl);
        uint256 priceForPublic = (weiDeposited.sub(weiDepositedWhitelist)).div(pikaForPublic);
        return priceForPublic > minPrice ? priceForPublic : minPrice;
    }

    // Modifier is eligible sender modifier
    modifier isEligibleSender() {
        require(msg.sender == tx.origin, "Contracts are not allowed to snipe the sale");
        _;
    }
}