const { ethers } = require("hardhat");


async function main() {
    // We get the contract to deploy
    const VaultTokenReward = await ethers.getContractFactory("VaultTokenReward");
    // const vaultTokenReward = await VaultTokenReward.deploy( "0x26D6ff77d5D45c91e288bf24540bb232f775020C", "0x84cca0E31CDbD21A99b81b6AB07aD80e4582F65e", "0xb9c649eE55E2252dc9387aadf8E289d5E3Ad2596"); // rinkeby
    // const vaultTokenReward = await VaultTokenReward.deploy( "0x80898b704bAa55e7e37F1128Fc6ae5836661f54a", "0x730506083eB07f26A8816a17f750D1d984C74eeF", "0x3b8ed42db806F3D8Dfdc491255eC9b3363D21005"); // optimism
    const vaultTokenReward = await VaultTokenReward.deploy( "0x349D5BF05960F02c6d228F5ECFE4793ec1B1130F", "0x0000000000000000000000000000000000000000", "0x30C5826aBA4660431aA3a0136011774022d2F6f6"); // rinkeby
    console.log("VaultTokenReward deployed to:", vaultTokenReward.address);
}

main()
    .then(() => process.exit(0))
    .catch(error => {
        console.error(error);
        process.exit(1);
    });
