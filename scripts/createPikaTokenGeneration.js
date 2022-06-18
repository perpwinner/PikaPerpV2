const { ethers, upgrades } = require("hardhat");

async function main() {
    const PikaTokenGeneration = await ethers.getContractFactory("PikaTokenGeneration");
    const pikaTokenGeneration = await PikaTokenGeneration.deploy("0x5ED879fA2d41fAadf4054c7b3ED1003ebCE59198", "0x349D5BF05960F02c6d228F5ECFE4793ec1B1130F", "1650949098", "1651035498", "1651121898", "1000000000000000000", "100000000000000000000", "50000000000000000", "100000000000000000", "150000000000000000", "0xd283bb82523d22bdfe2d5f9b74cf1d2c34c1a6dd402976f28d2c8a97d13af551"); // rinkeby
    await pikaTokenGeneration.deployed();
    console.log("PikaTokenGeneration deployed to:", pikaTokenGeneration.address);
}

main();
