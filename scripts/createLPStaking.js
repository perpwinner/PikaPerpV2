const { ethers } = require("hardhat");


async function main() {
    // We get the contract to deploy
    const Staking = await ethers.getContractFactory("Staking");
    const staking = await Staking.deploy("0xea9E5999eddaab9Ee42Dc9E7E696E3dFADaAe990", 2592000, "0x26D6ff77d5D45c91e288bf24540bb232f775020C", "0x40fbecb7826e2d162f7691a0b27ca70f6f7b5b54");

    console.log("Staking deployed to:", staking.address);
}

main()
    .then(() => process.exit(0))
    .catch(error => {
        console.error(error);
        process.exit(1);
    });
