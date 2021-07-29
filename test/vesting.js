const { expect } = require("chai");
const { BigNumber } = require("ethers");
const { ethers, network } = require("hardhat");

// helper to forward time
const forwardTime = async (seconds) => {
    await network.provider.send("evm_increaseTime", [seconds]);
    await network.provider.send("evm_mine", []);
};

describe("Unit Test: Vesting", function () {
    let vesting;
    let accounts;
    let token;

    beforeEach(async () => {
        const Vesting = await ethers.getContractFactory("Vesting");
        const SampleToken = await ethers.getContractFactory("SampleERC20");
        vesting = await Vesting.deploy();
        token = await SampleToken.deploy(ethers.utils.parseEther("10000"));
        await vesting.deployed();
        await token.deployed();
        accounts = await ethers.getSigners();
    });

    context("Vest", async () => {
        context("when cliff >= vesting", async () => {
            it("reverts", async () => {
                await expect(
                    vesting.vest(
                        accounts[0].address,
                        ethers.utils.parseEther("1"),
                        token.address,
                        true,
                        10,
                        5,
                        0
                    )
                ).to.be.revertedWith("Vesting: cliff after vesting period");
            });
        });

        context("when not enough tokens are held in the contract", async () => {
            it("reverts", async () => {
                await expect(
                    vesting.vest(
                        accounts[0].address,
                        ethers.utils.parseEther("1"),
                        token.address,
                        true,
                        5,
                        10,
                        0
                    )
                ).to.be.revertedWith("Vesting: Not enough tokens");
            });
        });

        context("when enough tokens are held", async () => {
            beforeEach(async () => {
                await token.transfer(
                    vesting.address,
                    ethers.utils.parseEther("10")
                );
                await vesting.vest(
                    accounts[0].address,
                    ethers.utils.parseEther("1"),
                    token.address,
                    true,
                    5,
                    10,
                    0
                );
            });

            it("creates a vesting schedule", async () => {
                let userVesting = await vesting.schedules(accounts[0].address, 0);
                // total, claimed, asset, start, cliff, end, isFixed
                expect(userVesting.totalAmount).to.equal(ethers.utils.parseEther("1"));
                expect(userVesting.claimedAmount).to.equal(ethers.utils.parseEther("0"));
                expect(userVesting.startTime).to.equal(0);
                expect(userVesting.cliffTime).to.equal(5 * 7 * 24 * 60 * 60); // 5 days in seconds
                expect(userVesting.endTime).to.equal(10 * 7 * 24 * 60 * 60); // 10 days in seconds
            });

        });
    });

    context("Multi Vest", async () => {
        context("when amounts and to arrays differ in length", async () => {
            it("reverts", async () => {
                await expect(
                    vesting.multiVest(
                        [accounts[0].address],
                        [
                            ethers.utils.parseEther("1"),
                            ethers.utils.parseEther("1"),
                        ],
                        token.address,
                        true,
                        10,
                        5,
                        0
                    )
                ).to.be.revertedWith("Vesting: Array lengths differ");
            });
        });

        context("when amounts and to have the correct length", async () => {
            beforeEach(async() => {
                // deposit enough tokens
                await token.transfer(
                    vesting.address,
                    ethers.utils.parseEther("10")
                );
            })

            it("sets up multiple schedules", async () => {
                await vesting.multiVest(
                    [accounts[1].address, accounts[2].address],
                    [
                        ethers.utils.parseEther("1"),
                        ethers.utils.parseEther("1"),
                    ],
                    token.address,
                    true,
                    1,
                    5,
                    0
                );
                
                // todo verify schedules
            });
        });
    });

    context("Claim", async () => {
        beforeEach(async () => {
            // create vesting for account 0
            let now = Math.floor(new Date().getTime() / 1000);
            await token.transfer(vesting.address, ethers.utils.parseEther("10"));
            await vesting.vest(
                accounts[1].address,
                ethers.utils.parseEther("1"),
                token.address,
                true,
                5,
                10,
                now
            );
        });
        context("when sender is not vester", async () => {
            it("reverts", async () => {
                await expect(
                    vesting.connect(accounts[2]).claim(0)
                ).to.be.revertedWith("Vesting: not claimable");
            });
        });

        context("when claimable", async () => {
            it("changes balances appropriately", async () => {
                // fast forward 5 days
                await forwardTime(7 * 7 * 24 * 60 * 60);
                // get balance and locked before and after second attempted claim
                let balanceBefore = await token.balanceOf(accounts[1].address);
                let lockedBefore = await vesting.locked(token.address);
                let contractBalanceBefore = await token.balanceOf(vesting.address);
                await vesting.connect(accounts[1]).claim(0);
                let balanceAfter = await token.balanceOf(accounts[1].address);
                let lockedAfter = await vesting.locked(token.address);
                let contractBalanceAfter = await token.balanceOf(vesting.address);
                // user balance increased
                expect(balanceBefore).to.be.lt(balanceAfter);
                // locked decreased
                expect(lockedBefore).to.be.gt(lockedAfter);
                // contract balance decreased
                expect(contractBalanceBefore).to.be.gt(contractBalanceAfter);
            });
        });

        context("when all tokens have been claimed", async () => {
            it("sends no more and does not reduce tokens locked", async () => {
                // fast forward 11 days
                await forwardTime(11 * 7 * 24 * 60 * 60);
                // claim once first
                await vesting.connect(accounts[1]).claim(0);
                // fast forward a day
                await forwardTime(1 * 7 * 24 * 60 * 60);

                // get balance and locked before and after second attempted claim
                let balanceBefore = await token.balanceOf(accounts[1].address);
                let lockedBefore = await vesting.locked[token.address];
                await vesting.connect(accounts[1]).claim(0);
                let balanceAfter = await token.balanceOf(accounts[1].address);
                let lockedAfter = await vesting.locked[token.address];
                expect(balanceBefore).to.equal(balanceAfter);
                expect(lockedBefore).to.equal(lockedAfter);
            });
        });
    });

    context("Rug", async () => {
        beforeEach(async () => {
            // create a vesting NFT for account 0
            let now = Math.floor(new Date().getTime() / 1000);
            await token.transfer(vesting.address, ethers.utils.parseEther("10"));
            await vesting.vest(
                accounts[1].address,
                ethers.utils.parseEther("1"),
                token.address,
                true,
                5,
                10,
                now
            );
        });

        context("when not called by the owner", async () => {
            it("reverts", async () => {
                await expect(
                    vesting.connect(accounts[1]).rug(accounts[1].address, 0)
                ).to.be.revertedWith("Ownable: caller is not the owner");
            });
        });

        context("when called by the owner", async () => {
            context("if the schedule is fixed", async () => {
                it("reverts", async () => {
                    await expect(
                        vesting.connect(accounts[0]).rug(accounts[1].address, 0)
                    ).to.be.revertedWith("Vesting: Account is fixed");
                });
            });

            context("if the schedule is not fixed", async () => {
                it("sends remaining tokens back to the owner", async () => {
                    // create a non fixed vesting for account 2
                    let now = Math.floor(new Date().getTime() / 1000);
                    await vesting.vest(
                        accounts[2].address,
                        ethers.utils.parseEther("1"),
                        token.address,
                        false,
                        5,
                        10,
                        now
                    );

                    // measure balances before and after
                    let ownerBalanceBefore = await token.balanceOf(
                        accounts[0].address
                    );
                    // this is now token id 1
                    await vesting.connect(accounts[0]).rug(accounts[2].address, 0);
                    let ownerBalanceAfter = await token.balanceOf(
                        accounts[0].address
                    );
                    expect(ownerBalanceAfter).to.equal(
                        ownerBalanceBefore.add(ethers.utils.parseEther("1"))
                    );
                });
            });
        });
    });

    context("Withdraw", async () => {
        context("when the contract balance is too low", async () => {
            it("reverts", async () => {
                let now = Math.floor(new Date().getTime() / 1000);
                await token.transfer(
                    vesting.address,
                    ethers.utils.parseEther("10")
                );
                await vesting.vest(
                    accounts[1].address,
                    ethers.utils.parseEther("8"),
                    token.address,
                    true,
                    5,
                    10,
                    now
                );

                // withdraw more than possible (locked = 8, total = 10, withdraw = 3)
                await expect(
                    vesting.withdraw(ethers.utils.parseEther("3"), token.address)
                ).to.be.revertedWith("Vesting: Can't withdraw");
            });
        });

        context("when excess tokens are held", async () => {
            it("withdraws to the owner", async () => {
                let now = Math.floor(new Date().getTime() / 1000);
                await token.transfer(
                    vesting.address,
                    ethers.utils.parseEther("10")
                );
                await vesting.vest(
                    accounts[1].address,
                    ethers.utils.parseEther("5"),
                    token.address,
                    true,
                    5,
                    10,
                    now
                );

                let ownerBalanceBefore = await token.balanceOf(
                    accounts[0].address
                );
                // withdraw all excess tokens
                await vesting.withdraw(
                    ethers.utils.parseEther("5"),
                    token.address
                );
                let ownerBalanceAfter = await token.balanceOf(
                    accounts[0].address
                );
                expect(ownerBalanceAfter).to.equal(
                    ownerBalanceBefore.add(ethers.utils.parseEther("5"))
                );
            });
        });
    });
});