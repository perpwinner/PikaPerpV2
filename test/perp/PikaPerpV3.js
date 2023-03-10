
const { ethers } = require("hardhat");
const { expect } = require("chai");
const { waffle } = require("hardhat");
const { parseUnits, formatUnits } = require('./utils.js');
const { utils, BigNumber } = require("ethers")
require("@nomiclabs/hardhat-web3");
const hre = require("hardhat");
const provider = waffle.provider

const maxShift = 0.003e8; // max shift (shift is used adjust the price to balance the longs and shorts)


let latestPrice = 3000e8;

let maxPrice = 100000000e8

function getOraclePrice(feed) {
	return latestPrice;
}

function _calculatePrice(feed, isLong, openInterestLong, openInterestShort, maxExposure, reserve, amount) {
	let oraclePrice = getOraclePrice(feed);

	let shift = (openInterestLong - openInterestShort) * maxShift / maxExposure;
	if (isLong) {
		// console.log("amount", amount)
		let slippage = parseInt((reserve * reserve / (reserve - amount) - reserve) * (10**8) / amount);
		slippage = shift >= 0 ? parseInt(slippage + shift) : Math.ceil(slippage - (-1 * shift / 2));
		// console.log("shift", shift)
		let price = oraclePrice * slippage / (10**8);
		// console.log("price", price);
		// console.log("price", price + price * fee / 10**4);
		return Math.ceil(price);
	} else {
		let slippage = parseInt((reserve - reserve * reserve / (reserve + amount)) * (10**8) / amount);
		slippage = shift >= 0 ? parseInt(slippage + shift / 2) : parseInt(slippage - (-1 * shift));
		// console.log("shift", shift)
		let price = oraclePrice * slippage / (10**8);
		// console.log("oraclePrice", oraclePrice);
		// console.log("price", price);
		// console.log("price", price - price * fee / 10**4);
		return Math.ceil(price);
	}
}

function getInterestFee(margin, leverage, interest, interval) {
	return margin * leverage * interest * interval / ((10**12) * (86400 * 365));
}

function getPositionId(account, productId, isLong) {
	return web3.utils.soliditySha3(
		{t: 'address', v: account},
		{t: 'uint256', v: productId},
		{t: 'bool', v: isLong}
	);
}

function getPositionKey(account, index) {
	return web3.utils.soliditySha3(
		{t: 'address', v: account},
		{t: 'uint256', v: index}
	);
}

// Assert that actual is less than 1/accuracy difference from expected
function assertAlmostEqual(actual, expected, accuracy = 10000000) {
	const expectedBN = BigNumber.isBigNumber(expected) ? expected : BigNumber.from(expected)
	const actualBN = BigNumber.isBigNumber(actual) ? actual : BigNumber.from(actual)
	const diffBN = expectedBN.gt(actualBN) ? expectedBN.sub(actualBN) : actualBN.sub(expectedBN)
	if (expectedBN.gt(0)) {
		return expect(
			diffBN).to.lt(expectedBN.div(BigNumber.from(accuracy.toString()))
		)
	}
	return expect(
		diffBN).to.lt(-1 * expectedBN.div(BigNumber.from(accuracy.toString()))
	)
}


describe("Trading", () => {

	let trading, addrs = [], owner, oracle, usdc, fundingManager, pika, vePikaFeeReward, vaultFeeReward, vaultTokenReward, rewardToken, orderbook, feeCalculator, positionManager;

	before(async () => {

		addrs = provider.getWallets();
		owner = addrs[0];

		const usdcContract = await ethers.getContractFactory("TestUSDC");
		usdc = await usdcContract.deploy();
		await usdc.mint(owner.address, 1000000000000);
		await usdc.mint(addrs[1].address, 1000000000000);
		const oracleContract = await ethers.getContractFactory("MockOracle");
		oracle = await oracleContract.deploy();

		const fundingManagerContract = await ethers.getContractFactory("FundingManager");
		fundingManager = await fundingManagerContract.deploy();

		const pikaContract = await ethers.getContractFactory("Pika");
		pika = await pikaContract.deploy("Pika", "PIKA", "1000000000000000000000000000", owner.address, owner.address)
		await pika.setTransfersAllowed(true);

		const feeCalculatorContract = await ethers.getContractFactory("FeeCalculator");
		feeCalculator = await feeCalculatorContract.deploy(40, 9000, oracle.address);
		// await feeCalculator.setFeeTier([1000, 10000, 100000, 500000, 1000000, 2500000, 5000000], [0, 500, 1500, 2500, 3500, 4000, 4500, 0])

		const tradingContract = await ethers.getContractFactory("PikaPerpV3");
		trading = await tradingContract.deploy(usdc.address, 1000000, oracle.address, feeCalculator.address, fundingManager.address);

		await fundingManager.setPikaPerp(trading.address);

		const pikaMineContract = await hre.ethers.getContractFactory("PikaMine")
		const pikaMine = await pikaMineContract.connect(owner).deploy();
		await pikaMine.initialize(
			pika.address
		)
		const vePIKAFeeRewardContract = await ethers.getContractFactory("VePikaFeeReward");
		vePikaFeeReward = await vePIKAFeeRewardContract.deploy(pika.address, usdc.address);
		const vaultFeeRewardContract = await ethers.getContractFactory("VaultFeeReward");
		vaultFeeReward = await vaultFeeRewardContract.deploy(trading.address, usdc.address, 1000000);
		const mockRewardTokenContract = await ethers.getContractFactory("TestUSDC");
		rewardToken = await mockRewardTokenContract.deploy();
		await rewardToken.mint(owner.address, 100000000000);
		const vaultTokenRewardContract = await ethers.getContractFactory("VaultTokenReward");
		vaultTokenReward = await vaultTokenRewardContract.deploy(owner.address, rewardToken.address, trading.address);

		await trading.setDistributors(addrs[2].address, vePikaFeeReward.address, vaultFeeReward.address, vaultTokenReward.address);
		await vePikaFeeReward.setPikaPerp(trading.address);
		await vaultFeeReward.setPikaPerp(trading.address);
		await pika.approve(vePikaFeeReward.address, "1000000000000000000000000000");
		await pika.transfer(addrs[1].address, "10000000000000000000000000")
		await pika.connect(addrs[1]).approve(vePikaFeeReward.address, "1000000000000000000000000000");

		const orderbookContract = await ethers.getContractFactory("OrderBook");
		orderbook = await orderbookContract.deploy(trading.address, oracle.address, usdc.address, "1000000",
			"100000", feeCalculator.address);

		const positionManagerContract = await ethers.getContractFactory("PositionManager");
		positionManager = await positionManagerContract.deploy(trading.address, feeCalculator.address, oracle.address, usdc.address, "100000", "1000000");

		let v = [
			100000000000000, //1m usdc cap
			0,
			0,
			0,
			3600
		]

		await trading.updateVault(v);

		let p = [
			oracle.address, // chainlink
			50e8,
			0.1 * 100, // 0.1%
			true,
			0,
			0,
			150, // 1.5%, minPriceChange
			10,
			50000000e8 // 50m usdc
			// "30000000000000000" // 300m usdc
		]
		// add products
		await trading.addProduct(1, p);
		// set maxMargin
		await trading.setMinMargin("10000000000");
	});

	it("Owner should be set", async () => {
		expect(await trading.owner()).to.equal(owner.address);
	});

	it("Should fail setting owner from other address", async () => {
		await expect(trading.connect(addrs[1]).setOwner(addrs[1].address)).to.be.revertedWith('!gov');
	});

	it("Owner should setParameters", async () => {
		await trading.setParameters("1000000", "86400", true, true, true, true, "10000", "10000", "3", "5000", "8000","2");
		expect(await trading.maxShift()).to.equal("1000000");
		expect(await trading.minProfitTime()).to.equal("86400");
		// expect(await trading.exposureMultiplier()).to.equal("10000");
		// expect(await trading.utilizationMultiplier()).to.equal("10000");
		await trading.setParameters("300000", "43200", true, true, false, false, "10000", "10000", "3","5000","8000","2");
	});

	describe("trade", () => {


		const productId = 1;
		const margin = 1000e8; // 1000usd
		const leverage = 10e8;
		const userId = 1;
		const gasPrice = 3e8

		before(async () => {
			// console.log("owner", await trading.owner());
			// console.log(owner.address)
			await usdc.connect(owner).approve(trading.address, "10000000000000000000000")
			await usdc.connect(addrs[1]).approve(trading.address, "10000000000000000000000")
			await trading.connect(owner).stake(10000000000000, owner.address); // stake 100k usdc
		})

		it(`long positions`, async () => {

			const user = addrs[userId].address;

			const balance_user = await usdc.balanceOf(user);
			const balance_contract = await usdc.balanceOf(trading.address);

			// 1. open long
			const price1 = _calculatePrice(oracle.address, true, 0, 0, parseFloat((await trading.getVault()).balance), 50000000e8, margin*leverage/1e8);
			// console.log("price 1", price1);
			let fee = margin*leverage/1e8*0.001;
			const tx1 = await trading.connect(addrs[userId]).openPosition(addrs[userId].address, productId, margin, true, leverage.toString());
			const receipt = await provider.getTransactionReceipt(tx1.hash);

			let positionId = getPositionId(user, productId, true);
			expect(await tx1).to.emit(trading, "NewPosition").withArgs(positionId, user, productId, true, price1.toString(), getOraclePrice(oracle.address), margin.toString(), leverage.toString(), margin*leverage/1e8*0.001);
			// Check balances
			// console.log(await usdc.balanceOf(trading.address), (balance_contract.add(BigNumber.from(margin/100 + fee/100*0.7))))
			expect(await usdc.balanceOf(user)).to.be.equal((balance_user - margin/100 - fee/100).toLocaleString('fullwide', {useGrouping:false}))

			assertAlmostEqual(await usdc.balanceOf(user), (balance_user - margin/100 - fee/100).toLocaleString('fullwide', {useGrouping:false}))
			assertAlmostEqual(await usdc.balanceOf(trading.address), (balance_contract.add(BigNumber.from(margin/100 + fee/100))))
			assertAlmostEqual((await trading.getPendingProtocolReward()).mul("100"), fee*0.2);
			assertAlmostEqual((await trading.getPendingPikaReward()).mul("100"), fee*0.3);
			assertAlmostEqual((await trading.getPendingVaultReward()).mul("100"), fee*0.5);

			// // Check user positions
			const position1 = (await trading.getPositions([positionId]))[0];
			expect(position1.productId).to.equal(productId);
			expect(position1.owner).to.equal(user);
			expect(position1.isLong).to.equal(true);
			expect(position1.margin).to.equal(margin);
			expect(position1.leverage).to.equal(leverage);
			assertAlmostEqual(position1.price, price1);
			// console.log("after open long", (await usdc.balanceOf(trading.address)).toString());

			// 2. increase position
			const leverage2 = parseUnits(20)
			const price2 = _calculatePrice(oracle.address, true, margin*leverage/1e8, 0, parseFloat((await trading.getVault()).balance), 50000000e8, margin*leverage2/1e8);
			await trading.connect(addrs[userId]).openPosition(addrs[userId].address, productId, margin, true, leverage2.toString());
			const position2 = (await trading.getPositions([positionId]))[0];
			expect(position2.margin).to.equal(margin*2);
			expect(position2.leverage).to.equal(leverage*1.5);
			// expect(position2.funding).to.equal(63); // 95*2/3
			assertAlmostEqual(position2.price, ((price1+price2*2)/3).toFixed(0));

			// await provider.send("evm_increaseTime", [100])
			// await trading.connect(addrs[userId]).openPosition(addrs[userId].address, productId, margin, true, leverage2.toString());
			// const position3 = (await trading.getPositions([positionId]))[0];
			// console.log("position3 funding", position3.funding)
			// // expect(position3.funding).to.equal(11491); // (28633 * 2 + 63*3) / 5
			// expect(position3.margin).to.equal(margin*3);

			// console.log("after increase long", (await usdc.balanceOf(trading.address)).toString());

			// 3. close long before minProfitTime with profit less than threshold
			await provider.send("evm_increaseTime", [500])
			latestPrice = 3029e8;
			const price3 = _calculatePrice(oracle.address, false, 3*margin*leverage/1e8, 0, parseFloat((await trading.getVault()).balance), 50000000e8, 3*margin*leverage/1e8);
			await oracle.setPrice(3029e8);
			const totalFee = parseInt(3*margin*leverage/1e8*0.001 + getInterestFee(3*margin, leverage, 0, 500));
			const tx3 = await trading.connect(addrs[userId]).closePositionWithId(positionId, 3*margin);
			// await expect(tx3).to.emit(trading, "ClosePosition").withArgs(positionId, user, productId, price3.toString(), position2.price, (2*margin).toString(), (leverage*1.5).toString(), totalFee.toString(), 0, 127720499, false);
			// console.log("after close long", (await usdc.balanceOf(trading.address)).toString());
			// console.log("vault balance", (await trading.getVault()).balance.toString());
		});

		it(`long and partial close`, async () => {

			const user = addrs[userId].address;

			const balance_user = await usdc.balanceOf(user);
			const balance_contract = await usdc.balanceOf(trading.address);

			// 1. open long
			const price1 = _calculatePrice(oracle.address, true, 0, 0, parseFloat((await trading.getVault()).balance), 50000000e8, margin*leverage/1e8);
			let fee = margin*leverage/1e8*0.001;
			const tx1 = await trading.connect(addrs[userId]).openPosition(addrs[userId].address, productId, margin, true, leverage.toString());
			const receipt = await provider.getTransactionReceipt(tx1.hash);

			let positionId = getPositionId(user, productId, true);
			expect(await tx1).to.emit(trading, "NewPosition").withArgs(positionId, user, productId, true, price1.toString(), getOraclePrice(oracle.address), margin.toString(), leverage.toString(), margin*leverage/1e8*0.001);
			// Check balances
			let newUserBalance = balance_user - margin/100 - fee/100;
			let newContractBalance = balance_contract.add(BigNumber.from(margin/100 + fee/100));
			assertAlmostEqual(await usdc.balanceOf(user), newUserBalance.toLocaleString('fullwide', {useGrouping:false}))
			assertAlmostEqual(await usdc.balanceOf(trading.address), newContractBalance)

			// Check user positions
			const position1 = (await trading.getPositions([positionId]))[0];
			expect(position1.productId).to.equal(productId);
			expect(position1.owner).to.equal(user);
			expect(position1.isLong).to.equal(true);
			expect(position1.margin).to.equal(margin);
			expect(position1.leverage).to.equal(leverage);
			assertAlmostEqual(position1.price, price1);
			// console.log("after open long", (await usdc.balanceOf(trading.address)).toString());

			// 2. partial close long before minProfitTime with profit less than threshold
			await provider.send("evm_increaseTime", [500])
			latestPrice = 3029e8;
			const price3 = _calculatePrice(oracle.address, false, margin*leverage/1e8, 0, parseFloat((await trading.getVault()).balance), 50000000e8, margin/2*leverage/1e8);
			await oracle.setPrice(3029e8);
			const tx3 = await trading.connect(addrs[userId]).closePositionWithId(positionId, margin/2);
			// expect(await tx3).to.emit(trading, "ClosePosition").withArgs(positionId, user, productId, false, price3.toString(), position1.price, (margin/2).toString(), leverage.toString(), 0, true, false);
			// assertAlmostEqual(await usdc.balanceOf(user),  (newUserBalance - margin/200 - fee/200).toLocaleString('fullwide', {useGrouping:false}))
			// assertAlmostEqual(await usdc.balanceOf(trading.address), newContractBalance.add(BigNumber.from(margin/200 + fee/200)))
			await trading.connect(addrs[userId]).closePositionWithId(positionId, margin/2);
		});

		it(`short positions`, async () => {

			const user = addrs[userId].address;

			const balance_user = await usdc.balanceOf(user);
			const balance_contract = await usdc.balanceOf(trading.address);

			// 1. open short
			const price1 = _calculatePrice(oracle.address, false, 0, 0, parseFloat((await trading.getVault()).balance), 50000000e8, margin*leverage/1e8);
			let fee = margin*leverage/1e8*0.001;
			const tx1 = await trading.connect(addrs[userId]).openPosition(addrs[userId].address, productId, margin, false, leverage.toString());
			let positionId = getPositionId(user, productId, false, false);
			// await expect(tx1).to.emit(trading, "NewPosition").withArgs(positionId, user, productId, false, price1.toString(), getOraclePrice(oracle.address), margin.toString(), leverage.toString(), margin*leverage/1e8*0.001, false, 314638);

			// Check balances
			assertAlmostEqual(await usdc.balanceOf(user), (balance_user - margin/100 - fee/100).toLocaleString('fullwide', {useGrouping:false}))
			assertAlmostEqual(await usdc.balanceOf(trading.address), (balance_contract.add(BigNumber.from(margin/100 + fee/100))))

			// // Check user positions
			const position1 = (await trading.getPositions([positionId]))[0];
			expect(position1.productId).to.equal(productId);
			expect(position1.owner).to.equal(user);
			expect(position1.isLong).to.equal(false);
			expect(position1.margin).to.equal(margin);
			expect(position1.leverage).to.equal(leverage);
			// expect(position1.funding).to.equal(314638);
			assertAlmostEqual(position1.price, price1);
			// console.log("after open short", (await usdc.balanceOf(trading.address)).toString());

			// 2. increase position
			await provider.send("evm_increaseTime", [100])
			const leverage2 = parseUnits(20)
			const price2 = _calculatePrice(oracle.address, false, 0, margin*leverage/1e8, parseFloat((await trading.getVault()).balance), 50000000e8, margin*leverage2/1e8);
			await trading.connect(addrs[userId]).openPosition(addrs[userId].address, productId, margin, false, leverage2.toString());
			const position2 = (await trading.getPositions([positionId]))[0];
			expect(position2.margin).to.equal(margin*2);
			expect(position2.leverage).to.equal(leverage*1.5);
			// expect(position2.funding).to.equal(314638);
			// console.log("postion2 price", position2.price.toString());
			assertAlmostEqual(position2.price, ((price1+price2*2)/3).toFixed(0));
			// console.log("after increase short", (await usdc.balanceOf(trading.address)).toString());

			// 3. close short before minProfitTime with profit less than threshold
			await provider.send("evm_increaseTime", [100])
			latestPrice = 3000e8;
			const price3 = _calculatePrice(oracle.address, true, 0, 3*margin*leverage/1e8, parseFloat((await trading.getVault()).balance), 50000000e8, 3*margin*leverage/1e8);
			await oracle.setPrice(3000e8);
			// await trading.setFees(0.01e8, 0);
			// const tx3 = await trading.connect(addrs[userId]).closePosition(positionId, 3*margin);
			const tx3 = await trading.connect(addrs[userId]).closePosition(addrs[userId].address, 1, 3*margin, false);
			// console.log("after close short", (await usdc.balanceOf(trading.address)).toString());
			// console.log("vault balance", (await trading.getVault()).balance.toString());
			const totalFee = 3*margin*leverage/1e8*0.001 + getInterestFee(3*margin, leverage, 0, 200);
			// console.log(totalFee);
			// await expect(tx3).to.emit(trading, "ClosePosition").withArgs(positionId, user, productId, price3.toString(), position2.price, (2*margin).toString(), (leverage*1.5).toString(), totalFee.toString(), 0, 0, false);

		});

		it(`liquidations`, async () => {

			const user = addrs[userId].address;

			const balance_user = await usdc.balanceOf(user);
			const balance_contract = await usdc.balanceOf(trading.address);

			// 1. open long
			latestPrice = 3000e8;
			await oracle.setPrice(3000e8);
			const price1 = _calculatePrice(oracle.address, true, 0, 0, parseFloat((await trading.getVault()).balance), 50000000e8, margin*leverage/1e8);
			let fee = margin*leverage/1e8*0.001;
			const tx1 = await trading.connect(addrs[userId]).openPosition(addrs[userId].address, productId, margin, true, leverage.toString());

			let positionId = getPositionId(user, productId, true);
			expect(await tx1).to.emit(trading, "NewPosition").withArgs(positionId, user, productId, true, price1.toString(), getOraclePrice(oracle.address), margin.toString(), leverage.toString(), margin*leverage/1e8*0.001);

			// Check balances
			assertAlmostEqual(await usdc.balanceOf(user), (balance_user - margin/100 - fee/100).toLocaleString('fullwide', {useGrouping:false}))
			// assertAlmostEqual(await usdc.balanceOf(trading.address), (balance_contract.add(BigNumber.from(margin/100))))

			// // Check user positions
			const position1 = (await trading.getPositions([positionId]))[0];
			expect(position1.productId).to.equal(productId);
			expect(position1.owner).to.equal(user);
			expect(position1.isLong).to.equal(true);
			expect(position1.margin).to.equal(margin);
			expect(position1.leverage).to.equal(leverage);
			assertAlmostEqual(position1.price, price1);
			// console.log("after open long", (await usdc.balanceOf(trading.address)).toString());

			// 2. liquidation
			await provider.send("evm_increaseTime", [500])
			latestPrice = 2760e8;
			// const price3 = _calculatePriceWithFee(oracle.address, 10, false, margin*leverage/1e8, 0, 100000000e8, 50000000e8, margin*leverage/1e8);
			await oracle.setPrice(2760e8);
			await trading.setParameters("300000", "43200", true, true, false, false, "10000", "10000", "3", "5000", "8000", "2");
			const tx3 = await trading.connect(addrs[userId]).liquidatePositions([positionId]);
			const totalFee = getInterestFee(3*margin, leverage, 0, 500);
			expect(await tx3).to.emit(trading, "ClosePosition").withArgs(positionId, user, productId, latestPrice, position1.price, margin.toString(), leverage.toString(), totalFee, (-1*margin).toString(), true);
			// console.log("after liquidation", (await usdc.balanceOf(trading.address)).toString());
			// console.log("vault balance", (await trading.getVault()).balance.toString());
		});

		it(`stake`, async () => {
			await provider.send("evm_increaseTime", [80])
			const vault1 = await trading.getVault();
			// console.log(vault1.staked.toString())
			// console.log("Vault1 balance", vault1.balance.toString())
			// console.log(vault1.shares.toString())
			await trading.setParameters("300000", "43200", true, true, false, false, "10000", "5000", "3", "8000", "10000", "2");
			const amount = 1000000000000;
			await trading.connect(addrs[1]).stake(amount, addrs[1].address);

			const stake0 = await trading.getStake(owner.address);
			const stake1 = await trading.getStake(addrs[1].address);
			expect(stake0.shares).to.equal(BigNumber.from(vault1.shares))
			expect(stake1.shares).to.equal(BigNumber.from(amount).mul(vault1.shares).div(vault1.balance))

			// const vault2 = await trading.getVault();
			// console.log(vault2.staked.toString())
			// console.log(vault2.balance.toString())
			// console.log(vault2.shares.toString())
			await provider.send("evm_increaseTime", [3600])
			const userBalanceStart = await usdc.balanceOf(owner.address);
			await trading.connect(owner).redeem(owner.address, 5000000000000, owner.address); // redeem half
			const userBalanceNow = await usdc.balanceOf(owner.address);
			assertAlmostEqual(userBalanceNow.sub(userBalanceStart), vault1.balance.div(100).div(2))
		})

		it(`vault fee reward`, async () => {
			// redeem all
			await provider.send("evm_increaseTime", [3600])
			const startVaultFeeContractUsdc = await usdc.balanceOf(vaultFeeReward.address);
			const pendingVaultReward = await trading.getPendingVaultReward();
			await trading.redeem(owner.address, (await trading.getShare(owner.address)), owner.address);
			await trading.connect(addrs[1]).redeem(addrs[1].address, await trading.getShare(addrs[1].address), addrs[1].address);
			expect((await usdc.balanceOf(vaultFeeReward.address)).sub(startVaultFeeContractUsdc)).to.be.equal(pendingVaultReward)

			// stake
			expect(await trading.getPendingVaultReward()).to.be.equal(0);
			// console.log("pendingPikaReward", (await trading.getPendingPikaReward()).toString());
			const startOwnerClaimableReward = await vaultFeeReward.getClaimableReward(owner.address);
			const startAddress1ClaimableReward = await vaultFeeReward.getClaimableReward(addrs[1].address);
			await trading.connect(owner).stake("10000000000000", owner.address);
			await trading.connect(owner).openPosition(owner.address, productId, margin, true, leverage.toString());
			expect((await vaultFeeReward.getClaimableReward(owner.address)).sub(startOwnerClaimableReward)).to.be.equal("5000000");
			await trading.connect(addrs[1]).stake("10000000000000", addrs[1].address);
			expect((await vaultFeeReward.getClaimableReward(addrs[1].address)).sub(startAddress1ClaimableReward)).to.be.equal("0");
			expect(await trading.getTotalShare()).to.be.equal("20000000000000");

			await trading.connect(addrs[userId]).openPosition(addrs[userId].address, productId, margin, true, leverage.toString());

			expect((await vaultFeeReward.getClaimableReward(owner.address)).sub(startOwnerClaimableReward)).to.be.equal("7500000");
			expect((await vaultFeeReward.getClaimableReward(addrs[1].address)).sub(startAddress1ClaimableReward)).to.be.equal("2500000");
			const usdcBeforeClaim = await usdc.balanceOf(owner.address);
			const currentClaimableReward = await vaultFeeReward.getClaimableReward(owner.address);
			// await trading.connect(owner).setManager(vaultFeeReward.address, true);
			// await trading.connect(owner).setAccountManager(vaultFeeReward.address, true);
			// await vaultFeeReward.connect(owner).reinvest();
			await vaultFeeReward.connect(owner).claimReward();
			expect((await usdc.balanceOf(owner.address)).sub(usdcBeforeClaim)).to.be.equal(currentClaimableReward);

			// redeem
			const shareBefore = await trading.getShare(addrs[1].address);
			await provider.send("evm_increaseTime", [3600])
			await trading.connect(addrs[1]).redeem(addrs[1].address, shareBefore, addrs[1].address);
			expect(await trading.getShare(addrs[1].address)).to.be.equal(0);
			const usdcBeforeClaim2 = await usdc.balanceOf(addrs[1].address);
			const currentClaimableRewardAddrs1 = await vaultFeeReward.getClaimableReward(addrs[1].address);
			await vaultFeeReward.connect(addrs[1]).claimReward();
			expect((await usdc.balanceOf(addrs[1].address)).sub(usdcBeforeClaim2)).to.be.equal(currentClaimableRewardAddrs1);

			await trading.connect(owner).closePosition(owner.address, productId, margin, true);
			await trading.connect(addrs[userId]).closePosition(addrs[userId].address, productId, margin, true);
			await trading.connect(owner).redeem(owner.address, (await trading.getShare(owner.address)), owner.address);
		})

		it(`vault token reward`, async () => {
			const account1 = addrs[3]
			const account2 = addrs[4]
			await usdc.mint(account1.address, 1000000000000);
			await usdc.mint(account2.address, 1000000000000);

			// stakingAccount1 stake
			await usdc.connect(account1).approve(trading.address, "500000000000")
			await trading.connect(account1).stake("500000000000", account1.address)
			expect(await vaultTokenReward.balanceOf(account1.address)).to.be.equal("5000000000000000000000")

			await rewardToken.mint(owner.address, "1000000000000000000000");
			await rewardToken.connect(owner).transfer(vaultTokenReward.address, "1000000000000000000000");
			await vaultTokenReward.connect(owner).notifyRewardAmount("1000000000000000000000");
			const rewardRate = await vaultTokenReward.rewardRate();

			// 1 hour later stakingAccount1 check rewards
			await provider.send("evm_increaseTime", [3600])
			await provider.send("evm_mine")
			const account1Earned = await vaultTokenReward.earned(account1.address);
			assertAlmostEqual(account1Earned, rewardRate.mul(3600), 1000)

			// account2 stake the same amount as stakingAccount1's current staked balance
			await usdc.connect(account2).approve(trading.address, "10000000000000000000000")
			await trading.connect(account2).stake("500000000000", account2.address)
			expect(await vaultTokenReward.balanceOf(account2.address)).to.be.equal("5000000000000000000000")
			expect(await trading.getTotalShare()).to.be.equal("1000000000000")

			// 1 hour later check rewards
			await provider.send("evm_increaseTime", [3600])
			await provider.send("evm_mine")
			const newRewardRate = await vaultTokenReward.rewardRate();
			const newAccount1Earned = await vaultTokenReward.earned(account1.address)
			const account2Earned = await vaultTokenReward.earned(account2.address)
			assertAlmostEqual(newAccount1Earned.sub(account1Earned), newRewardRate.mul(3600).div(2), 100)
			assertAlmostEqual(account2Earned, newRewardRate.mul(3600).div(2), 100)

			// claim reward for account1
			await vaultTokenReward.connect(account1).getReward()
			assertAlmostEqual(await rewardToken.balanceOf(account1.address), newAccount1Earned, 1000)

			// claim reward for account2
			await vaultTokenReward.connect(account2).getReward()
			assertAlmostEqual(await rewardToken.balanceOf(account2.address), account2Earned, 1000)
			expect(await trading.getTotalShare()).to.be.equal("1000000000000")
		})

		it(`orderbook`, async () => {
			const account1 = addrs[5]
			const account2 = addrs[6]
			await usdc.mint(account1.address, 1000000000000);
			await usdc.mint(account2.address, 1000000000000);

			const amount = "100000000000";
			const leverage = "200000000";
			const size = amount;
			const executionFee = "1000000000000000";
			await oracle.setPrice(3001e8);
			await trading.connect(owner).setManager(orderbook.address, true);
			await trading.connect(account1).setAccountManager(orderbook.address, true);
			await orderbook.connect(owner).setAllowPublicKeeper(true);
			// let ethAmount = (BigNumber.from(amount).mul(BigNumber.from("10010000000")));
			await usdc.connect(account1).approve(orderbook.address, "10000000000000000000000")
			// create open order
			await orderbook.connect(account1).createOpenOrder(1, amount, leverage,  true, "300000000000", false, "100000", {from: account1.address, value:
				executionFee, gasPrice: gasPrice})

			const openOrder1 = (await orderbook.getOpenOrder(account1.address, 0));
			expect(openOrder1.margin.toString()).to.be.equal(amount);
			// cancel open order
			await orderbook.connect(account1).cancelOpenOrder(0);
			const openOrder2 = (await orderbook.getOpenOrder(account1.address, 0));
			expect(openOrder2.margin.toString()).to.be.equal("0");
			// create open order again
			await orderbook.connect(account1).createOpenOrder(1, amount, leverage, true, "300000000000", false, "100000", {from: account1.address, value:
				executionFee, gasPrice: gasPrice})

			await expect(orderbook.connect(account2).executeOpenOrder(account1.address, 1, account2.address)).to.be.revertedWith('OrderBook: invalid price for execution');
			// update open order
			await orderbook.connect(account1).updateOpenOrder(1, "200000000", "300100000000", false);
			// execute open order
			await orderbook.connect(account2).executeOpenOrder(account1.address, 1, account2.address);

			const position1 = await trading.getPosition(account1.address, 1, true);
			expect(position1[0]).to.equal(productId);
			expect(position1[5]).to.equal(account1.address);
			expect(position1[7]).to.equal(true);
			expect(position1[1]).to.equal("200000000");

			// create close order
			await orderbook.connect(account1).createCloseOrder(1, size, true, "300000000000", false, {from: account1.address, value: "1000000000000000", gasPrice: gasPrice})
			const closeOrder1 = (await orderbook.getCloseOrder(account1.address, 0));
			expect(closeOrder1.size.toString()).to.be.equal(size);
			// cancel close order
			await orderbook.connect(account1).cancelCloseOrder(0);
			const closeOrder2 = (await orderbook.getCloseOrder(account1.address, 0));
			expect(closeOrder2.size.toString()).to.be.equal("0");
			// create close order again
			await orderbook.connect(account1).createCloseOrder(1, size, true, "300000000000", false, {from: account1.address, value: "1000000000000000", gasPrice: gasPrice})
			await expect(orderbook.connect(account2).executeCloseOrder(account1.address, 1, account2.address)).to.be.revertedWith('OrderBook: invalid price for execution');
			// update close order
			await orderbook.connect(account1).updateCloseOrder(1, "200000000000", "300100000000", false);
			// execute close order
			await orderbook.connect(account2).executeCloseOrder(account1.address, 1, account2.address);
			const position2 = await trading.getPosition(account1.address, 1, true);
			expect(position2[4]).to.equal("0");
		})

		it(`positionManager`, async () => {
			const account1 = addrs[7]
			const account2 = addrs[8]
			const keeper = addrs[9]
			await usdc.mint(account1.address, 1000000000000);
			await usdc.mint(account2.address, 1000000000000);

			const amount = "100000000000";
			const leverage = "200000000";
			const tradeFee = "200000000"
			const size = amount;
			const executionFee = "1000000000000000";
			await oracle.setPrice(3001e8);
			await trading.connect(owner).setManager(positionManager.address, true);
			await trading.connect(account1).setAccountManager(positionManager.address, true);
			await trading.connect(account2).setAccountManager(positionManager.address, true);
			await positionManager.connect(owner).setPositionKeeper(keeper.address, true);
			await positionManager.connect(owner).setDelayValues(3, 3, 30, 30, 300);
			// let ethAmount = (BigNumber.from(amount).mul(BigNumber.from("10010000000")));
			await usdc.connect(account1).approve(positionManager.address, "10000000000000000000000")
			await usdc.connect(account2).approve(positionManager.address, "10000000000000000000000")

			// 1. cancel open order with user account
			await positionManager.connect(account1).createOpenPosition(1, amount, leverage,  true, "300000000000", "100000", {from: account1.address, value:
				executionFee, gasPrice: gasPrice})
			const openPositionRequest1 = (await positionManager.getOpenPositionRequest(account1.address, 1));
			expect(openPositionRequest1.margin.toString()).to.be.equal(amount);
			await expect(positionManager.connect(account2).cancelOpenPosition(getPositionKey(account1.address, 1), owner.address)).to.be.revertedWith("PositionManager: forbidden");
			await expect(positionManager.connect(account1).cancelOpenPosition(getPositionKey(account1.address, 1), owner.address)).to.be.revertedWith("PositionManager: min delay not yet passed for cancellation");
			await provider.send("evm_increaseTime", [30])
			await provider.send("evm_mine")
			const account1Balance = await usdc.balanceOf(account1.address)
			await positionManager.connect(account1).cancelOpenPosition(getPositionKey(account1.address, 1), account1.address)
			const openPositionRequest2 = (await positionManager.getOpenPositionRequest(account1.address, 1));
			expect(openPositionRequest2.margin.toString()).to.be.equal("0");
			expect(await provider.getBalance(positionManager.address)).to.be.equal("0")
			expect((await usdc.balanceOf(account1.address)).sub(account1Balance).mul("100")).to.be.equal(BigNumber.from(amount).add(tradeFee))

			// 2. cancel open position with keeper account
			await positionManager.connect(account1).createOpenPosition(1, amount, leverage,  true, "300000000000", "100000", {from: account1.address, value:
				executionFee, gasPrice: gasPrice})
			await positionManager.connect(keeper).cancelOpenPosition(getPositionKey(account1.address, 2), owner.address)
			// should not cancel because of block time
			const openPositionRequest3 = (await positionManager.getOpenPositionRequest(account1.address, 2));
			expect(openPositionRequest3.margin.toString()).to.be.equal(amount);
			// should cancel after some blocks
			await provider.send("evm_increaseTime", [10]);
			await provider.send("evm_mine");
			await provider.send("evm_mine");
			const account1Balance1 = await usdc.balanceOf(account1.address)
			await positionManager.connect(keeper).cancelOpenPosition(getPositionKey(account1.address, 2), account1.address)
			const openPositionRequest4 = (await positionManager.getOpenPositionRequest(account1.address, 2));
			expect(openPositionRequest4.margin.toString()).to.be.equal("0");
			expect(await provider.getBalance(positionManager.address)).to.be.equal("0")
			expect((await usdc.balanceOf(account1.address)).sub(account1Balance1).mul("100")).to.be.equal(BigNumber.from(amount).add(tradeFee))

			// 3. cancel close position with user account
			await positionManager.connect(account1).createClosePosition(1, amount,  true, "300000000000", "100000", {from: account1.address, value:
				executionFee, gasPrice: gasPrice})
			const closePositionRequest1 = (await positionManager.getClosePositionRequest(account1.address, 1));
			expect(closePositionRequest1.margin.toString()).to.be.equal(amount);
			await expect(positionManager.connect(account2).cancelClosePosition(getPositionKey(account1.address, 1), owner.address)).to.be.revertedWith("PositionManager: forbidden");
			await expect(positionManager.connect(account1).cancelClosePosition(getPositionKey(account1.address, 1), owner.address)).to.be.revertedWith("PositionManager: min delay not yet passed for cancellation");
			await provider.send("evm_increaseTime", [30])
			await provider.send("evm_mine")
			await positionManager.connect(account1).cancelClosePosition(getPositionKey(account1.address, 1), account1.address)
			const closePositionRequest2 = (await positionManager.getClosePositionRequest(account1.address, 1));
			expect(closePositionRequest2.margin.toString()).to.be.equal("0");
			expect(await provider.getBalance(positionManager.address)).to.be.equal("0")

			// 4. cancel close position with keeper account
			await positionManager.connect(account1).createClosePosition(1, amount,  true, "300000000000", "100000", {from: account1.address, value:
				executionFee, gasPrice: gasPrice})
			await positionManager.connect(keeper).cancelClosePosition(getPositionKey(account1.address, 2), owner.address)
			// should not cancel because of block time
			const closePositionRequest3 = (await positionManager.getClosePositionRequest(account1.address, 2));
			expect(closePositionRequest3.margin.toString()).to.be.equal(amount);
			// should cancel after some blocks
			await provider.send("evm_increaseTime", [10]);
			await provider.send("evm_mine");
			await provider.send("evm_mine");
			await positionManager.connect(keeper).cancelClosePosition(getPositionKey(account1.address, 2), account1.address)
			const closePositionRequest4 = (await positionManager.getClosePositionRequest(account1.address, 2));
			expect(closePositionRequest4.margin.toString()).to.be.equal("0");
			expect(await provider.getBalance(positionManager.address)).to.be.equal("0")

			// 5. execute open position with user account
			await positionManager.connect(account1).createOpenPosition(1, amount, leverage,  true, "300000000000", "100000", {from: account1.address, value:
				executionFee, gasPrice: gasPrice})

			await expect(positionManager.connect(account2).executeOpenPosition(getPositionKey(account1.address, 3), account2.address)).to.be.revertedWith('PositionManager: forbidden');
			await expect(positionManager.connect(account1).executeOpenPosition(getPositionKey(account1.address, 3), account1.address)).to.be.revertedWith('PositionManager: min delay not yet passed for execution');

			await provider.send("evm_increaseTime", [30])
			await provider.send("evm_mine")

			await positionManager.connect(account1).executeOpenPosition(getPositionKey(account1.address, 3), account1.address)

			const position1 = await trading.getPosition(account1.address, 1, true);
			expect(position1[0]).to.equal(productId);
			expect(position1[1]).to.equal("200000000");
			expect(position1[4]).to.equal("100000000000");
			expect(position1[5]).to.equal(account1.address);
			expect(position1[7]).to.equal(true);
			// cannot execute open position after max time
			await positionManager.connect(account1).createOpenPosition(1, amount, leverage, true, "300000000000", "100000", {from: account1.address, value:
				executionFee, gasPrice: gasPrice})
			await provider.send("evm_increaseTime", [301])
			await provider.send("evm_mine")
			await expect(positionManager.connect(account1).executeOpenPosition(getPositionKey(account1.address, 4), account1.address)).to.be.revertedWith('PositionManager: request has expired');
			// can still execute position before max time
			await positionManager.connect(account1).createClosePosition(1, amount,  true, "300000000000", "100000", {from: account1.address, value:
				executionFee, gasPrice: gasPrice})
			await provider.send("evm_increaseTime", [290])
			await provider.send("evm_mine")
			await positionManager.connect(account1).executeClosePosition(getPositionKey(account1.address, 3), account1.address)
			const position2 = await trading.getPosition(account1.address, 1, true);
			expect(position2[0]).to.equal("0");

			// 6. execute open position with keeper account
			await positionManager.connect(account1).createOpenPosition(1, amount, leverage,  true, "300000000000", "100000", {from: account1.address, value:
				executionFee, gasPrice: gasPrice})

			await expect(positionManager.connect(keeper).executeOpenPosition(getPositionKey(account1.address, 5), account2.address)).to.be.revertedWith('PositionManager: current price too low');

			await positionManager.connect(account1).createOpenPosition(1, amount, leverage,  false, "300200000000", "100000", {from: account1.address, value:
				executionFee, gasPrice: gasPrice})
			await expect(positionManager.connect(keeper).executeOpenPosition(getPositionKey(account1.address, 6), account2.address)).to.be.revertedWith('PositionManager: current price too high');

			await positionManager.connect(account1).createOpenPosition(1, amount, leverage,  true, "300100000000", "100000", {from: account1.address, value:
				executionFee, gasPrice: gasPrice})
			await positionManager.connect(keeper).executeOpenPosition(getPositionKey(account1.address, 7), account1.address)
			// should not execute because of block time
			const position3 = await trading.getPosition(account1.address, 1, true);
			expect(position3[0]).to.equal("0");
			// should execute after some blocks
			await provider.send("evm_increaseTime", [10]);
			await provider.send("evm_mine");
			await provider.send("evm_mine");
			await positionManager.connect(keeper).executeOpenPosition(getPositionKey(account1.address, 7), account1.address)
			const position4 = await trading.getPosition(account1.address, 1, true);
			expect(position4[0]).to.equal("1");
			expect(position4[1]).to.equal("200000000");

			// 7. execute close position with user account
			await positionManager.connect(account1).createClosePosition(1, amount,  true, "300000000000", "100000", {from: account1.address, value:
				executionFee, gasPrice: gasPrice})

			await expect(positionManager.connect(account2).executeClosePosition(getPositionKey(account1.address, 4), account2.address)).to.be.revertedWith('PositionManager: forbidden');
			await expect(positionManager.connect(account1).executeClosePosition(getPositionKey(account1.address, 4), account1.address)).to.be.revertedWith('PositionManager: min delay not yet passed for execution');

			await provider.send("evm_increaseTime", [30])
			await provider.send("evm_mine")

			await positionManager.connect(account1).createOpenPosition(1, amount, leverage,  true, "300100000000", "100000", {from: account1.address, value:
				executionFee, gasPrice: gasPrice})
			await positionManager.connect(account1).executeOpenPosition(getPositionKey(account1.address, 7), account1.address)
			const position5 = await trading.getPosition(account1.address, 1, true);
			expect(position5[0]).to.equal("1");

			// 8. execute close position with keeper account
			await positionManager.connect(account1).createClosePosition(1, amount,  true, "300200000000", "100000", {from: account1.address, value:
				executionFee, gasPrice: gasPrice})
			await expect(positionManager.connect(keeper).executeClosePosition(getPositionKey(account1.address, 5), account1.address)).to.be.revertedWith('PositionManager: current price too high');
			// should not execute because of block time
			await positionManager.connect(account1).createClosePosition(1, amount,  true, "300000000000", "100000", {from: account1.address, value:
				executionFee, gasPrice: gasPrice})
			await positionManager.connect(keeper).executeClosePosition(getPositionKey(account1.address, 6), account1.address)
			const position6 = await trading.getPosition(account1.address, 1, true);
			expect(position6[0]).to.equal("1");
			// should execute after some blocks
			await provider.send("evm_increaseTime", [10]);
			await provider.send("evm_mine");
			await provider.send("evm_mine");
			await positionManager.connect(keeper).executeClosePosition(getPositionKey(account1.address, 6), account1.address)
			const position7 = await trading.getPosition(account1.address, 1, true);
			expect(position7[0]).to.equal("0");

			// 9. batch executions for long
			await positionManager.connect(keeper).executePositions(100, 100, account1.address) // clear all previous pending requests
			await positionManager.connect(owner).setDelayValues(5, 5, 30, 30, 300);
			await positionManager.connect(account2).createOpenPosition(1, amount, leverage,  true, "300100000000", "100000", {from: account2.address, value:
				executionFee, gasPrice: gasPrice})
			await positionManager.connect(account2).createOpenPosition(1, amount, leverage,  true, "300100000000", "100000", {from: account2.address, value:
				executionFee, gasPrice: gasPrice})
			await positionManager.connect(account2).createOpenPosition(1, amount, leverage,  true, "300000000000", "100000", {from: account2.address, value:
				executionFee, gasPrice: gasPrice})

			// all are skipped because of min block delay is not reached
			await positionManager.connect(keeper).executePositions(100, 100, account1.address)
			const position8 = await trading.getPosition(account2.address, 1, true);
			expect(position8[0]).to.equal("0");

			// 3 are executed, 2 are cancelled and 1 is skipped
			await positionManager.connect(account2).createClosePosition(1, amount,  true, "300100000000", "100000", {from: account2.address, value:
				executionFee, gasPrice: gasPrice})
			await positionManager.connect(account2).createClosePosition(1, amount,  true, "300200000000", "100000", {from: account2.address, value:
				executionFee, gasPrice: gasPrice})
			await provider.send("evm_increaseTime", [10]);
			await provider.send("evm_mine");
			await provider.send("evm_mine");
			await provider.send("evm_mine");
			await provider.send("evm_mine");
			await positionManager.connect(account2).createClosePosition(1, amount,  true, "300100000000", "100000", {from: account2.address, value:
				executionFee, gasPrice: gasPrice})

			await positionManager.connect(keeper).executePositions(100, 100, account1.address)
			const position9 = await trading.getPosition(account2.address, 1, true);
			expect(position9[0]).to.equal(productId);
			expect(position9[1]).to.equal("200000000");
			// executed the last request
			await provider.send("evm_increaseTime", [10]);
			await provider.send("evm_mine");
			await provider.send("evm_mine");
			await provider.send("evm_mine");
			await provider.send("evm_mine");
			await positionManager.connect(keeper).executePositions(100, 100, account1.address)
			const position10 = await trading.getPosition(account2.address, 1, true);
			expect(position10[0]).to.equal("0");

			// 9. batch executions for short
			await positionManager.connect(keeper).executePositions(100, 100, account1.address) // clear all previous pending requests
			await positionManager.connect(account2).createOpenPosition(1, amount, leverage, false, "300100000000", "100000", {from: account2.address, value:
				executionFee, gasPrice: gasPrice})
			await positionManager.connect(account2).createOpenPosition(1, amount, leverage, false, "300100000000", "100000", {from: account2.address, value:
				executionFee, gasPrice: gasPrice})
			await positionManager.connect(account2).createOpenPosition(1, amount, leverage, false, "300200000000", "100000", {from: account2.address, value:
				executionFee, gasPrice: gasPrice})

			// all are skipped because of min block delay is not reached
			await positionManager.connect(keeper).executePositions(100, 100, account1.address)
			const position11 = await trading.getPosition(account2.address, 1, false);
			expect(position11[0]).to.equal("0");

			// 3 are executed, 2 are cancelled and 1 is skipped
			await positionManager.connect(account2).createClosePosition(1, amount,  false, "300100000000", "100000", {from: account2.address, value:
				executionFee, gasPrice: gasPrice})
			await positionManager.connect(account2).createClosePosition(1, amount,  false, "200900000000", "100000", {from: account2.address, value:
				executionFee, gasPrice: gasPrice})
			await provider.send("evm_increaseTime", [10]);
			await provider.send("evm_mine");
			await provider.send("evm_mine");
			await provider.send("evm_mine");
			await provider.send("evm_mine");
			await positionManager.connect(account2).createClosePosition(1, amount,  false, "300100000000", "100000", {from: account2.address, value:
				executionFee, gasPrice: gasPrice})

			await positionManager.connect(keeper).executePositions(100, 100, account1.address)
			const position12 = await trading.getPosition(account2.address, 1, false);
			expect(position12[0]).to.equal(productId);
			expect(position12[1]).to.equal("200000000");
			// executed the last request
			await provider.send("evm_increaseTime", [10]);
			await provider.send("evm_mine");
			await provider.send("evm_mine");
			await provider.send("evm_mine");
			await provider.send("evm_mine");
			await positionManager.connect(keeper).executePositions(100, 100, account1.address)
			const position13 = await trading.getPosition(account2.address, 1, false);
			expect(position13[0]).to.equal("0");


			// await expect(positionManager.connect(account1).executeOpenPosition(getPositionKey(account1.address, 3), account1.address)).to.be.revertedWith('PositionManager: min delay not yet passed');

			// await provider.send("evm_increaseTime", [30])
			// await provider.send("evm_mine")
			//
			// await positionManager.connect(account1).executeOpenPosition(getPositionKey(account1.address, 3), account1.address)
			//
			// const position1 = await trading.getPosition(account1.address, 1, true);
			// console.log(position1)
			// expect(position1[0]).to.equal(productId);
			// expect(position1[5]).to.equal(account1.address);
			// expect(position1[8]).to.equal(true);
			// expect(position1[1]).to.equal("200000000");
			//
			// await positionManager.connect(account1).createOpenPosition(1, amount, leverage, true, "300000000000", "100000", {from: account1.address, value:
			// 	executionFee, gasPrice: gasPrice})
			// await provider.send("evm_increaseTime", [301])
			// await provider.send("evm_mine")
			// await expect(positionManager.connect(account1).executeOpenPosition(getPositionKey(account1.address, 4), account1.address)).to.be.revertedWith('PositionManager: request has expired');

			// await positionManager.connect(account1).createClosePosition(1, amount, true, "300000000000", "100000", {from: account1.address, value:
			// 	executionFee, gasPrice: gasPrice})
			// await provider.send("evm_increaseTime", [301])
			// await provider.send("evm_mine")
			// await positionManager.connect(account1).executeClosePosition(getPositionKey(account1.address, 3), account1.address)

			// // create close order
			// await orderbook.connect(account1).createCloseOrder(1, size, true, "300000000000", false, {from: account1.address, value: "1000000000000000", gasPrice: gasPrice})
			// const closeOrder1 = (await orderbook.getCloseOrder(account1.address, 0));
			// expect(closeOrder1.size.toString()).to.be.equal(size);
			// // cancel close order
			// await orderbook.connect(account1).cancelCloseOrder(0);
			// const closeOrder2 = (await orderbook.getCloseOrder(account1.address, 0));
			// expect(closeOrder2.size.toString()).to.be.equal("0");
			// // create close order again
			// await orderbook.connect(account1).createCloseOrder(1, size, true, "300000000000", false, {from: account1.address, value: "1000000000000000", gasPrice: gasPrice})
			// await expect(orderbook.connect(account2).executeCloseOrder(account1.address, 1, account2.address)).to.be.revertedWith('OrderBook: invalid price for execution');
			// // update close order
			// await orderbook.connect(account1).updateCloseOrder(1, "200000000000", "300100000000", false);
			// // execute close order
			// await orderbook.connect(account2).executeCloseOrder(account1.address, 1, account2.address);
			// const position2 = await trading.getPosition(account1.address, 1, true);
			// expect(position2[4]).to.equal("0");
		})
	});
});
