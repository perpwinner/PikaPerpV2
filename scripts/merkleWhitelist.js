
const { utils } = require("ethers");
const { MerkleTree } = require("merkletreejs");
const keccak256 = require("keccak256");

async function getMerkleTree () {
    const users = [
        { address: "0xf2d09a2B2Db41B37C90509aB554A7aaf5e19956f", amount: "50000000000000000" },
        { address: "0x60CaB7f3cEAd8762726162fb1F05d3BFEa4A9922", amount: "100000000000000000" },
        { address: "0x9e9F157e8a203893A0117EBeCDb92037ac0EDA2A", amount: "150000000000000000" },
        { address: "0xD244BBa5EC7d8792dA721Cbe11B32bA1c3Bc9cca", amount: "150000000000000000" }
    ];

    // equal to MerkleDistributor.sol #keccak256(abi.encodePacked(account, amount));
    const elements = users.map((x) =>
        utils.solidityKeccak256(["address", "uint256"], [x.address, x.amount])
    );

    return new MerkleTree(elements, keccak256, { sort: true });
}

async function getMerkleProof(beneficiary, amount) {
    const merkleTree = await getMerkleTree();
    console.log(merkleTree.getHexRoot())
    const leaf = utils.solidityKeccak256(["address", "uint256"], [beneficiary, amount]);
    console.log(merkleTree.getHexProof(leaf));
}

getMerkleProof("0x9e9F157e8a203893A0117EBeCDb92037ac0EDA2A", "150000000000000000")
