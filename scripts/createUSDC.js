const { ethers } = require("hardhat");


async function main() {
    // We get the contract to deploy
    const USDC = await ethers.getContractFactory("TestUSDC");
    const usdc = await USDC.deploy();

    console.log("usdc deployed to:", usdc.address);
}

main()
    .then(() => process.exit(0))
    .catch(error => {
        console.error(error);
        process.exit(1);
    });
