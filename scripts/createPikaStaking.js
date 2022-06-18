const { ethers } = require("hardhat");


async function main() {
    // We get the contract to deploy
    const PikaStaking = await ethers.getContractFactory("PikaStaking");
    const pikaStaking = await PikaStaking.deploy("0xF1b821742bf9164eE90bAaEbe703028d7FC566fa", "0x84cca0E31CDbD21A99b81b6AB07aD80e4582F65e");

    console.log("Staking deployed to:", pikaStaking.address);
}

main()
    .then(() => process.exit(0))
    .catch(error => {
        console.error(error);
        process.exit(1);
    });
