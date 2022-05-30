// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "./IPikaPerp.sol";
import '../lib/UniERC20.sol';
import "./IPikaPerp.sol";
import "./PikaPerpV3.sol";
import "../access/Governable.sol";

contract PositionManager is Governable, ReentrancyGuard {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;
    using UniERC20 for IERC20;
    using Address for address payable;

    struct OpenPositionRequest {
        address account;
        uint256 productId;
        uint256 margin;
        uint256 leverage;
        bool isLong;
        uint256 acceptablePrice;
        uint256 executionFee;
        uint256 blockNumber;
        uint256 blockTime;
    }

    struct ClosePositionRequest {
        address account;
        uint256 productId;
        uint256 margin;
        bool isLong;
        uint256 acceptablePrice;
        uint256 executionFee;
        uint256 blockNumber;
        uint256 blockTime;
    }

    address public admin;

    address public immutable pikaPerp;
    address public feeCalculator;
    address public oracle;
    address public immutable collateralToken;
    uint256 public minExecutionFee;

    uint256 public minBlockDelayKeeper;
    uint256 public minTimeDelayPublic;
    uint256 public maxTimeDelay;

    bool public isUserSettleEnabled = true;
    bool public allowPublicKeeper = false;

    bytes32[] public openPositionRequestKeys;
    bytes32[] public closePositionRequestKeys;

    uint256 public openPositionRequestKeysStart;
    uint256 public closePositionRequestKeysStart;

    uint256 public immutable tokenBase;
    uint256 public constant BASE = 1e8;

    mapping (address => bool) public isPositionKeeper;

    mapping (address => uint256) public openPositionsIndex;
    mapping (bytes32 => OpenPositionRequest) public openPositionRequests;

    mapping (address => uint256) public closePositionsIndex;
    mapping (bytes32 => ClosePositionRequest) public closePositionRequests;

    event CreateOpenPosition(
        address indexed account,
        uint256 productId,
        uint256 margin,
        uint256 leverage,
        bool isLong,
        uint256 acceptablePrice,
        uint256 executionFee,
        uint256 index,
        uint256 blockNumber,
        uint256 blockTime,
        uint256 gasPrice
    );

    event ExecuteOpenPosition(
        address indexed account,
        uint256 productId,
        uint256 margin,
        uint256 leverage,
        bool isLong,
        uint256 acceptablePrice,
        uint256 executionFee,
        uint256 blockGap,
        uint256 timeGap
    );

    event CancelIncreasePosition(
        address indexed account,
        uint256 productId,
        uint256 margin,
        uint256 leverage,
        bool isLong,
        uint256 acceptablePrice,
        uint256 executionFee,
        uint256 blockGap,
        uint256 timeGap
    );

    event CreateClosePosition(
        address indexed account,
        uint256 productId,
        uint256 margin,
        bool isLong,
        uint256 acceptablePrice,
        uint256 executionFee,
        uint256 index,
        uint256 blockNumber,
        uint256 blockTime
    );

    event ExecuteClosePosition(
        address indexed account,
        uint256 productId,
        uint256 margin,
        bool isLong,
        uint256 acceptablePrice,
        uint256 executionFee,
        uint256 blockGap,
        uint256 timeGap
    );

    event CancelClosePosition(
        address indexed account,
        uint256 productId,
        uint256 margin,
        bool isLong,
        uint256 acceptablePrice,
        uint256 executionFee,
        uint256 blockGap,
        uint256 timeGap
    );
    event ExecuteOpenPositionError(bytes32, address, string);
    event ExecuteClosePositionError(bytes32, address, string);
    event SetPositionKeeper(address indexed account, bool isActive);
    event SetMinExecutionFee(uint256 minExecutionFee);
    event SetIsUserSettleEnabled(bool isUserSettleEnabled);
    event SetDelayValues(uint256 minBlockDelayKeeper, uint256 minTimeDelayPublic, uint256 maxTimeDelay);
    event SetRequestKeysStartValues(uint256 increasePositionRequestKeysStart, uint256 decreasePositionRequestKeysStart);
    event SetAllowPublicKeeper(bool allowPublicKeeper);
    event SetAdmin(address admin);

    modifier onlyPositionKeeper() {
        require(isPositionKeeper[msg.sender], "PositionManager: forbidden");
        _;
    }

    modifier onlyAdmin() {
        require(msg.sender == admin, "PositionManager: forbidden");
        _;
    }

    constructor(
        address _pikaPerp,
        address _feeCalculator,
        address _oracle,
        address _collateralToken,
        uint256 _minExecutionFee,
        uint256 _tokenBase
    ) public {
        pikaPerp = _pikaPerp;
        feeCalculator = _feeCalculator;
        oracle = _oracle;
        collateralToken = _collateralToken;
        minExecutionFee = _minExecutionFee;
        tokenBase = _tokenBase;
        admin = msg.sender;
    }

    function setFeeCalculator(address _feeCalculator) external onlyAdmin {
        feeCalculator = _feeCalculator;
    }

    function setOracle(address _oracle) external onlyAdmin {
        oracle = _oracle;
    }

    function setPositionKeeper(address _account, bool _isActive) external onlyAdmin {
        isPositionKeeper[_account] = _isActive;
        emit SetPositionKeeper(_account, _isActive);
    }

    function setMinExecutionFee(uint256 _minExecutionFee) external onlyAdmin {
        minExecutionFee = _minExecutionFee;
        emit SetMinExecutionFee(_minExecutionFee);
    }

    function setIsUserSettleEnabled(bool _isUserSettleEnabled) external onlyAdmin {
        isUserSettleEnabled = _isUserSettleEnabled;
        emit SetIsUserSettleEnabled(_isUserSettleEnabled);
    }

    function setDelayValues(uint256 _minBlockDelayKeeper, uint256 _minTimeDelayPublic, uint256 _maxTimeDelay) external onlyAdmin {
        minBlockDelayKeeper = _minBlockDelayKeeper;
        minTimeDelayPublic = _minTimeDelayPublic;
        maxTimeDelay = _maxTimeDelay;
        emit SetDelayValues(_minBlockDelayKeeper, _minTimeDelayPublic, _maxTimeDelay);
    }

    function setRequestKeysStartValues(uint256 _increasePositionRequestKeysStart, uint256 _decreasePositionRequestKeysStart) external onlyAdmin {
        openPositionRequestKeysStart = _increasePositionRequestKeysStart;
        closePositionRequestKeysStart = _decreasePositionRequestKeysStart;

        emit SetRequestKeysStartValues(_increasePositionRequestKeysStart, _decreasePositionRequestKeysStart);
    }

    function setAllowPublicKeeper(bool _allowPublicKeeper) external onlyAdmin {
        allowPublicKeeper = _allowPublicKeeper;
        emit SetAllowPublicKeeper(_allowPublicKeeper);
    }

    function setAdmin(address _admin) external onlyGov {
        admin = _admin;
        emit SetAdmin(_admin);
    }

    function setPricesAndExecutePositions(
        address[] memory tokens,
        uint256[] memory prices,
        uint256 _openEndIndex,
        uint256 _closeEndIndex,
        address payable _executionFeeReceiver
    ) external onlyPositionKeeper {
        IOracle(oracle).setPrices(tokens, prices);
        executePositions(_openEndIndex, _closeEndIndex, _executionFeeReceiver);
    }

    function executePositions(uint256 _openEndIndex, uint256 _closeEndIndex, address payable _executionFeeReceiver) public {
        executeOpenPositions(_openEndIndex, _executionFeeReceiver);
        executeClosePositions(_closeEndIndex, _executionFeeReceiver);
    }

    function executeOpenPositions(uint256 _endIndex, address payable _executionFeeReceiver) public onlyPositionKeeper {
        uint256 index = openPositionRequestKeysStart;
        uint256 length = openPositionRequestKeys.length;

        if (index >= length) { return; }

        if (_endIndex > length) {
            _endIndex = length;
        }

        while (index < _endIndex) {
            bytes32 key = openPositionRequestKeys[index];

            // if the request was executed then delete the key from the array
            // if the request was not executed then break from the loop, this can happen if the
            // minimum number of blocks has not yet passed
            // an error could be thrown if the request is too old or if the slippage is
            // higher than what the user specified, or if there is insufficient liquidity for the position
            // in case an error was thrown, cancel the request
            try this.executeOpenPosition(key, _executionFeeReceiver) returns (bool _wasExecuted) {
                if (!_wasExecuted) { break; }
            } catch Error(string memory executionError) {
                emit ExecuteOpenPositionError(key, openPositionRequests[key].account, executionError);
                // wrap this call in a try catch to prevent invalid cancels from blocking the loop
                try this.cancelOpenPosition(key, _executionFeeReceiver) returns (bool _wasCancelled) {
                    if (!_wasCancelled) { break; }
                } catch {}
            } catch (bytes memory /*lowLevelData*/) {
                // wrap this call in a try catch to prevent invalid cancels from blocking the loop
                try this.cancelOpenPosition(key, _executionFeeReceiver) returns (bool _wasCancelled) {
                    if (!_wasCancelled) { break; }
                } catch {}
            }

            delete openPositionRequestKeys[index];
            index++;
        }

        openPositionRequestKeysStart = index;
    }

    function executeClosePositions(uint256 _endIndex, address payable _executionFeeReceiver) public onlyPositionKeeper {
        uint256 index = closePositionRequestKeysStart;
        uint256 length = closePositionRequestKeys.length;

        if (index >= length) { return; }

        if (_endIndex > length) {
            _endIndex = length;
        }

        while (index < _endIndex) {
            bytes32 key = closePositionRequestKeys[index];

            // if the request was executed then delete the key from the array
            // if the request was not executed then break from the loop, this can happen if the
            // minimum number of blocks has not yet passed
            // an error could be thrown if the request is too old
            // in case an error was thrown, cancel the request
            try this.executeClosePosition(key, _executionFeeReceiver) returns (bool _wasExecuted) {
                if (!_wasExecuted) { break; }
            }  catch Error(string memory executionError)  {
                emit ExecuteClosePositionError(key, closePositionRequests[key].account, executionError);
                // wrap this call in a try catch to prevent invalid cancels from blocking the loop
                try this.cancelClosePosition(key, _executionFeeReceiver) returns (bool _wasCancelled) {
                    if (!_wasCancelled) { break; }
                } catch {}
            }  catch (bytes memory /*lowLevelData*/) {
                // wrap this call in a try catch to prevent invalid cancels from blocking the loop
                try this.cancelClosePosition(key, _executionFeeReceiver) returns (bool _wasCancelled) {
                    if (!_wasCancelled) { break; }
                } catch {}
            }

            delete closePositionRequestKeys[index];
            index++;
        }

        closePositionRequestKeysStart = index;
    }

    function createOpenPosition(
        uint256 _productId,
        uint256 _margin,
        uint256 _leverage,
        bool _isLong,
        uint256 _acceptablePrice,
        uint256 _executionFee
    ) external payable nonReentrant {
        require(_executionFee >= minExecutionFee, "PositionManager: invalid executionFee");

        if (IERC20(collateralToken).isETH()) {
            IERC20(collateralToken).uniTransferFromSenderToThis((_executionFee + _margin) * tokenBase / BASE);
        } else {
            require(msg.value == _executionFee * 1e18 / BASE, "PositionManager: incorrect execution fee transferred");
            IERC20(collateralToken).uniTransferFromSenderToThis(_margin * tokenBase / BASE);
        }

        _createOpenPosition(
            msg.sender,
            _productId,
            _margin,
            _leverage,
            _isLong,
            _acceptablePrice,
            _executionFee
        );
    }

    function createClosePosition(
        uint256 _productId,
        uint256 _margin,
        bool _isLong,
        uint256 _acceptablePrice,
        uint256 _executionFee
    ) external payable nonReentrant {
        require(_executionFee >= minExecutionFee, "PositionManager: invalid executionFee");
        require(msg.value == _executionFee * 1e18 / BASE, "PositionManager: invalid msg.value");

        _createClosePosition(
            msg.sender,
            _productId,
            _margin,
            _isLong,
            _acceptablePrice,
            _executionFee
        );
    }

    function getRequestQueueLengths() external view returns (uint256, uint256, uint256, uint256) {
        return (
        openPositionRequestKeysStart,
        openPositionRequestKeys.length,
        closePositionRequestKeysStart,
        closePositionRequestKeys.length
        );
    }

    function executeOpenPosition(bytes32 _key, address payable _executionFeeReceiver) public nonReentrant returns (bool) {
        OpenPositionRequest memory request = openPositionRequests[_key];
        // if the request was already executed or cancelled, return true so that the executeOpenPositions loop will continue executing the next request
        if (request.account == address(0)) { return true; }

        bool shouldExecute = _validateExecution(request.blockNumber, request.blockTime, request.account, request.productId, request.isLong, request.acceptablePrice);
        if (!shouldExecute) { return false; }

        delete openPositionRequests[_key];

        uint256 margin = request.margin * BASE / (BASE + getTradeFeeRate(request.productId, request.margin, request.leverage, request.account) * request.leverage / 10**4);
        if (IERC20(collateralToken).isETH()) {
            IPikaPerp(pikaPerp).openPosition{value: request.margin * tokenBase / BASE }(request.account, request.productId, margin, request.isLong, request.leverage);
        } else {
            IERC20(collateralToken).safeApprove(pikaPerp, 0);
            IERC20(collateralToken).safeApprove(pikaPerp, request.margin * tokenBase / BASE);
            IPikaPerp(pikaPerp).openPosition(request.account, request.productId, margin, request.isLong, request.leverage);
        }

        _executionFeeReceiver.sendValue(request.executionFee * 1e18 / BASE);

        emit ExecuteOpenPosition(
            request.account,
            request.productId,
            request.margin,
            request.leverage,
            request.isLong,
            request.acceptablePrice,
            request.executionFee,
            block.number.sub(request.blockNumber),
            block.timestamp.sub(request.blockTime)
        );

        return true;
    }

    function cancelOpenPosition(bytes32 _key, address payable _executionFeeReceiver) public nonReentrant returns (bool) {
        OpenPositionRequest memory request = openPositionRequests[_key];
        // if the request was already executed or cancelled, return true so that the executeOpenePositions loop will continue executing the next request
        if (request.account == address(0)) { return true; }

        bool shouldCancel = _validateCancellation(request.blockNumber, request.blockTime, request.account);
        if (!shouldCancel) { return false; }

        delete openPositionRequests[_key];

        if (IERC20(collateralToken).isETH()) {
            IERC20(collateralToken).uniTransfer(request.account, request.margin * tokenBase / BASE);
            IERC20(collateralToken).uniTransfer(_executionFeeReceiver, request.executionFee * tokenBase / BASE);
        } else {
            IERC20(collateralToken).uniTransfer(request.account, request.margin * tokenBase / BASE);
            payable(_executionFeeReceiver).sendValue(request.executionFee * 1e18 / BASE);
        }

        emit CancelIncreasePosition(
            request.account,
            request.productId,
            request.margin,
            request.leverage,
            request.isLong,
            request.acceptablePrice,
            request.executionFee,
            block.number.sub(request.blockNumber),
            block.timestamp.sub(request.blockTime)
        );

        return true;
    }

    function executeClosePosition(bytes32 _key, address payable _executionFeeReceiver) public nonReentrant returns (bool) {
        ClosePositionRequest memory request = closePositionRequests[_key];
        // if the request was already executed or cancelled, return true so that the executeClosePositions loop will continue executing the next request
        if (request.account == address(0)) { return true; }

        bool shouldExecute = _validateExecution(request.blockNumber, request.blockTime, request.account, request.productId, !request.isLong, request.acceptablePrice);
        if (!shouldExecute) { return false; }

        delete closePositionRequests[_key];

        IPikaPerp(pikaPerp).closePosition(request.account, request.productId, request.margin , request.isLong);

        _executionFeeReceiver.sendValue(request.executionFee * 1e18 / BASE);

        emit ExecuteClosePosition(
            request.account,
            request.productId,
            request.margin,
            request.isLong,
            request.acceptablePrice,
            request.executionFee,
            block.number.sub(request.blockNumber),
            block.timestamp.sub(request.blockTime)
        );

        return true;
    }

    function cancelClosePosition(bytes32 _key, address payable _executionFeeReceiver) public nonReentrant returns (bool) {
        ClosePositionRequest memory request = closePositionRequests[_key];
        // if the request was already executed or cancelled, return true so that the executeClosePositions loop will continue executing the next request
        if (request.account == address(0)) { return true; }

        bool shouldCancel = _validateCancellation(request.blockNumber, request.blockTime, request.account);
        if (!shouldCancel) { return false; }

        delete closePositionRequests[_key];

        _executionFeeReceiver.sendValue(request.executionFee * 1e18 / BASE);

        emit CancelClosePosition(
                request.account,
                request.productId,
                request.margin,
                request.isLong,
                request.acceptablePrice,
                request.executionFee,
                block.number.sub(request.blockNumber),
                block.timestamp.sub(request.blockTime)
            );

        return true;
    }

    function getRequestKey(address _account, uint256 _index) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(_account, _index));
    }

    function getOpenPositionRequest(address _account, uint256 _index) public view returns (OpenPositionRequest memory) {
        return openPositionRequests[getRequestKey(_account, _index)];
    }

    function getClosePositionRequest(address _account, uint256 _index) public view returns (ClosePositionRequest memory) {
        return closePositionRequests[getRequestKey(_account, _index)];
    }

    function getOpenPositionRequestFromKey(bytes32 _key) public view returns (OpenPositionRequest memory) {
        return openPositionRequests[_key];
    }

    function getClosePositionRequestFromKey(bytes32 _key) public view returns (ClosePositionRequest memory) {
        return closePositionRequests[_key];
    }

    function _validateExecution(uint256 _positionBlockNumber, uint256 _positionBlockTime, address _account,
        uint256 _productId, bool _isLong, uint256 _acceptablePrice
    ) internal view returns (bool) {
        if (_positionBlockTime.add(maxTimeDelay) <= block.timestamp && _isLong) {
            revert("PositionManager: request has expired");
        }

        bool isKeeperCall = msg.sender == address(this) || isPositionKeeper[msg.sender];

        if (!isUserSettleEnabled && !isKeeperCall) {
            revert("PositionManager: forbidden");
        }

        if (isKeeperCall) {
            (address productToken,,,,,,,,,,,) = IPikaPerp(pikaPerp).getProduct(_productId);
            uint256 price = _isLong ? IOracle(oracle).getPrice(productToken, true) : IOracle(oracle).getPrice(productToken, false);
            if (_isLong) {
                require(price <= _acceptablePrice, "PositionManager: current price too low");
            } else {
                require(price >= _acceptablePrice, "PositionManager: current price too high");
            }
            return _positionBlockNumber.add(minBlockDelayKeeper) <= block.number;
        }

        require(msg.sender == _account || allowPublicKeeper, "PositionManager: forbidden");

        require(_positionBlockTime.add(minTimeDelayPublic) <= block.timestamp, "PositionManager: min delay not yet passed for execution");

        return true;
    }

    function _validateCancellation(uint256 _positionBlockNumber, uint256 _positionBlockTime, address _account) internal view returns (bool) {
        bool isKeeperCall = msg.sender == address(this) || isPositionKeeper[msg.sender];

        if (!isUserSettleEnabled && !isKeeperCall) {
            revert("PositionManager: forbidden");
        }

        if (isKeeperCall) {
            return _positionBlockNumber.add(minBlockDelayKeeper) <= block.number;
        }

        require(msg.sender == _account, "PositionManager: forbidden");

        require(_positionBlockTime.add(minTimeDelayPublic) <= block.timestamp, "PositionManager: min delay not yet passed for cancellation");

        return true;
    }

    function _createOpenPosition(
        address _account,
        uint256 _productId,
        uint256 _margin,
        uint256 _leverage,
        bool _isLong,
        uint256 _acceptablePrice,
        uint256 _executionFee
    ) internal {
        uint256 index = openPositionsIndex[_account].add(1);
        openPositionsIndex[_account] = index;

        OpenPositionRequest memory request = OpenPositionRequest(
            _account,
            _productId,
            _margin,
            _leverage,
            _isLong,
            _acceptablePrice,
            _executionFee,
            block.number,
            block.timestamp
        );

        bytes32 key = getRequestKey(_account, index);
        openPositionRequests[key] = request;

        openPositionRequestKeys.push(key);

        emit CreateOpenPosition(
            _account,
            _productId,
            _margin,
            _leverage,
            _isLong,
            _acceptablePrice,
            _executionFee,
            index,
            block.number,
            block.timestamp,
            tx.gasprice
        );
    }

    function _createClosePosition(
        address _account,
        uint256 _productId,
        uint256 _margin,
        bool _isLong,
        uint256 _acceptablePrice,
        uint256 _executionFee
    ) internal {
        uint256 index = closePositionsIndex[_account].add(1);
        closePositionsIndex[_account] = index;

        ClosePositionRequest memory request = ClosePositionRequest(
            _account,
            _productId,
            _margin,
            _isLong,
            _acceptablePrice,
            _executionFee,
            block.number,
            block.timestamp
        );

        bytes32 key = getRequestKey(_account, index);
        closePositionRequests[key] = request;

        closePositionRequestKeys.push(key);

        emit CreateClosePosition(
            _account,
            _productId,
            _margin,
            _isLong,
            _acceptablePrice,
            _executionFee,
            index,
            block.number,
            block.timestamp
        );
    }

    function getTradeFeeRate(uint256 _productId, uint256 _margin, uint256 _leverage, address _account) private returns(uint256) {
        (address productToken,,uint256 fee,,,,,,,,,) = IPikaPerp(pikaPerp).getProduct(_productId);
        return IFeeCalculator(feeCalculator).getFee(productToken, fee, _account, msg.sender);
    }

    fallback() external payable {}
    receive() external payable {}
}