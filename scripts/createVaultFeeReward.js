const { ethers } = require("hardhat");


async function main() {
    // We get the contract to deploy
    const VaultFeeReward = await ethers.getContractFactory("VaultFeeReward");
    // const vaultFeeReward = await VaultFeeReward.deploy( "0xb9c649eE55E2252dc9387aadf8E289d5E3Ad2596", "0x84cca0E31CDbD21A99b81b6AB07aD80e4582F65e", 1000000);
    // const vaultFeeReward = await VaultFeeReward.deploy( "0x3b8ed42db806F3D8Dfdc491255eC9b3363D21005", "0x7F5c764cBc14f9669B88837ca1490cCa17c31607", 1000000);
    const vaultFeeReward = await VaultFeeReward.deploy( "0xeb270840335ee8006baa9cd175b5abc619bc6e2e", "0x0000000000000000000000000000000000000000", 1000000);

    console.log("Staking deployed to:", vaultFeeReward.address);
}

main()
    .then(() => process.exit(0))
    .catch(error => {
        console.error(error);
        process.exit(1);
    });
