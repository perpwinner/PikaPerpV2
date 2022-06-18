const { ethers } = require("hardhat");


async function main() {
    // We get the contract to deploy
    const RewardDistributor = await ethers.getContractFactory("RewardDistributor");
    const rewardDistributor = await RewardDistributor.deploy("0x079e30446c909362827bd244e4a66726fd7891E1", "0x0000000000000000000000000000000000000000");
    console.log("RewardDistributor deployed to:", rewardDistributor.address);
}

main()
    .then(() => process.exit(0))
    .catch(error => {
        console.error(error);
        process.exit(1);
    });
