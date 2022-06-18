const { ethers, upgrades } = require("hardhat");

async function main() {
    const PikaPerp = await ethers.getContractFactory("PikaPerpV2");
    // const pikaPerp = await PikaPerp.deploy("0x0a5ed85Bda88fc3fB6602D41308Eeb03F5D13dFb", "0x197922887aD5f21fE40cF517b255CDFa2F21A9bb"); // kovan
    // const pikaPerp = await PikaPerp.deploy("0x03f2922448261FB9920b5aFD0C339a9086F4881E", "0x61FeDB3C73F3DFb809118f937C32CbB944a306e7"); // optimistic kovan
    // const pikaPerp = await PikaPerp.deploy("0x84cca0E31CDbD21A99b81b6AB07aD80e4582F65e", 6, "0x7cb5d785847028c51a7adc253e21b3ac2582b40d", 5000000000); // rinkeby
    const pikaPerp = await PikaPerp.deploy("0x7F5c764cBc14f9669B88837ca1490cCa17c31607", 1000000, "0x250e7ab9b5ea0e95bf68f9fbe2f4f9dc5c8af746", 10000000000); // optimism mainnet
    await pikaPerp.deployed();
    console.log("PikaPerp deployed to:", pikaPerp.address);
}

main();
