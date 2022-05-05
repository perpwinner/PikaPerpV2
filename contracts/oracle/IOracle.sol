pragma solidity ^0.8.0;

interface IOracle {
    function getPrice(address feed) external view returns (uint256);
    function getPrice(address feed, uint256 orderTimestamp) external view returns (uint256);
    function getLastNPrices(address token, uint256 n) external view returns(uint256[] memory);
}
