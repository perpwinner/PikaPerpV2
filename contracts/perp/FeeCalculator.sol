// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/utils/math/SignedSafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "../oracle/IOracle.sol";

contract FeeCalculator is Ownable {

    uint256 public constant PRICE_BASE = 10000;
    uint256 public threshold;
    uint256 public weightDecay;
    uint256 public baseFee = 10;
    uint256 public n = 1;
    uint256 public maxDynamicFee = 50; // 0.5%
    address public oracle;
    bool public isDynamicFee = true;
    bool public isDiscountEnabled = false;
    mapping (address => uint256) public accountFeeDiscount;
    mapping (address => uint256) public senderFeeDiscount;

    constructor(uint256 _threshold, uint256 _weightDecay, address _oracle) public {
        threshold = _threshold;
        weightDecay = _weightDecay;
        oracle = _oracle;
    }

    /**
     * @notice Get the fee for a token for an account and sender.
     * @param token the underlying token for a product
     * @param productFee the default fee for a product
     * @param account the account to open position for. Some accounts may have discount in fees.
     * @param sender the sender of a transaction. Some senders may have discount in fees.
     * @return the total fee rate.
     */
    function getFee(address token, uint256 productFee, address account, address sender) external view returns (uint256) {
        uint256 fee = productFee;
        if (isDiscountEnabled) {
            uint256 discount = account == sender ? accountFeeDiscount[account] : accountFeeDiscount[account] + senderFeeDiscount[sender];
            uint256 fee = fee * (PRICE_BASE - discount) / PRICE_BASE;
        }
        if (isDynamicFee) {
            return fee + getDynamicFee(token);
        }
        return fee;
    }

    /**
     * @notice The dynamic fee to add to base fee. It is updated based on the volatility of recent price updates
     * Larger volatility leads to the higher the dynamic fee. It is used to mitigate oracle front-running.
     */
    function getDynamicFee(address token) public view returns (uint256) {
        uint256[] memory prices = IOracle(oracle).getLastNPrices(token, n);
        uint256 dynamicFee = 0;
        // go backwards in price array
        for (uint i = prices.length - 1; i > 0; i--) {
            dynamicFee = dynamicFee * weightDecay / PRICE_BASE;
            uint deviation = _calDeviation(prices[i - 1], prices[i], threshold);
            dynamicFee += deviation;
        }
        dynamicFee = dynamicFee > maxDynamicFee ? maxDynamicFee : dynamicFee;
        return dynamicFee;
    }

    function _calDeviation(
        uint256 price,
        uint256 previousPrice,
        uint256 threshold
    ) internal pure returns (uint256) {
        if (previousPrice == 0) {
            return 0;
        }
        uint256 absDelta = price > previousPrice ? price - previousPrice : previousPrice - price;
        uint256 deviationRatio = absDelta * PRICE_BASE / previousPrice;
        return deviationRatio > threshold ? deviationRatio - threshold : 0;
    }

    function setThreshold(uint256 _threshold) external onlyOwner {
        threshold = _threshold;
    }

    function setWeightDecay(uint256 _weightDecay) external onlyOwner {
        weightDecay = _weightDecay;
    }

    function setN(uint256 _n) external onlyOwner {
        n = _n;
    }

    function setIsDynamicFee(bool _isDynamicFee) external onlyOwner {
        isDynamicFee = _isDynamicFee;
    }

    function setIsDiscountEnabled(bool _isDiscountEnabled) external onlyOwner {
        isDiscountEnabled = _isDiscountEnabled;
    }

    function setMaxDynamicFee(uint256 _maxDynamicFee) external onlyOwner {
        maxDynamicFee = _maxDynamicFee;
    }

    function setDiscountForAccount(address _account, uint256 _discount) external onlyOwner {
        accountFeeDiscount[_account] = _discount;
    }

    function setDiscountForSender(address _sender, uint256 _discount) external onlyOwner {
        senderFeeDiscount[_sender] = _discount;
    }

}
