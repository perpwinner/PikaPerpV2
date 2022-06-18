const { ethers } = require("hardhat");


async function main() {
    // We get the contract to deploy
    const Pika = await ethers.getContractFactory("SimpleOracle");
    const pika = await Pika.deploy();

    console.log("Pika deployed to:", pika.address);
}

main()
    .then(() => process.exit(0))
    .catch(error => {
        console.error(error);
        process.exit(1);
    });
