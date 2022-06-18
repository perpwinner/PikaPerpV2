const { ethers } = require("hardhat");


async function main() {
    // We get the contract to deploy
    const Staking = await ethers.getContractFactory("Staking");
    const staking = await Staking.deploy("0x104Ff32217E9B63e44F7F2Fe325CBde034E7e52f", 2592000, "0x349D5BF05960F02c6d228F5ECFE4793ec1B1130F", "0x104Ff32217E9B63e44F7F2Fe325CBde034E7e52f");

    console.log("Staking deployed to:", staking.address);
}

main()
    .then(() => process.exit(0))
    .catch(error => {
        console.error(error);
        process.exit(1);
    });
