const { ethers } = require("hardhat");


async function main() {
    // We get the contract to deploy
    const Oracle = await ethers.getContractFactory("ChainlinkOracle");
    const oracle = await Oracle.deploy();
    console.log("oracle deployed to:", oracle.address);
}

main()
    .then(() => process.exit(0))
    .catch(error => {
        console.error(error);
        process.exit(1);
    });
