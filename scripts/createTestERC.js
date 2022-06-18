const { ethers } = require("hardhat");


async function main() {
    // We get the contract to deploy
    const TestERC = await ethers.getContractFactory("SimpleERC20");
    const testERC = await TestERC.deploy([18]);

    console.log("TestERC deployed to:", testERC.address);

    await testERC.mint("1000000000000000000000000000", "0x26D6ff77d5D45c91e288bf24540bb232f775020C")
}

main()
    .then(() => process.exit(0))
    .catch(error => {
        console.error(error);
        process.exit(1);
    });
