const { ethers } = require("hardhat");


async function main() {
    // We get the contract to deploy
    const Pika = await ethers.getContractFactory("Pika");
    // const pika = await Pika.deploy("0x26D6ff77d5D45c91e288bf24540bb232f775020C", "0x26D6ff77d5D45c91e288bf24540bb232f775020C");
    const pika = await Pika.deploy("Pika", "PIKA", "1000000000000000000000000000", "0x349D5BF05960F02c6d228F5ECFE4793ec1B1130F", "0x349D5BF05960F02c6d228F5ECFE4793ec1B1130F");
    console.log("Pika deployed to:", pika.address);
}

main()
    .then(() => process.exit(0))
    .catch(error => {
        console.error(error);
        process.exit(1);
    });
