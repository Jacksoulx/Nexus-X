import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";

describe("IntentBatcher", function () {
  const usdc = (value: number) => ethers.parseUnits(value.toString(), 6);

  async function deployFixture() {
    const [owner, agent, user, alice, bob, carol, unauthorized] = await ethers.getSigners();

    const registry = await ethers.deployContract("AgentRegistry", [owner.address]);
    const batcher = await ethers.deployContract("IntentBatcher", [
      owner.address,
      await registry.getAddress()
    ]);
    const token = await ethers.deployContract("MockUSDC", [owner.address]);

    await registry.registerAgent(agent.address);
    await token.mint(user.address, usdc(100));
    await token.connect(user).approve(await batcher.getAddress(), usdc(100));

    const tokenAddress = await token.getAddress();
    const intents = [
      {
        token: tokenAddress,
        from: user.address,
        to: alice.address,
        amount: usdc(10),
        userOpHash: ethers.id("transfer-10-to-alice")
      },
      {
        token: tokenAddress,
        from: user.address,
        to: bob.address,
        amount: usdc(5),
        userOpHash: ethers.id("transfer-5-to-bob")
      },
      {
        token: tokenAddress,
        from: user.address,
        to: carol.address,
        amount: usdc(2),
        userOpHash: ethers.id("transfer-2-to-carol")
      }
    ];

    return { owner, agent, user, alice, bob, carol, unauthorized, registry, batcher, token, intents };
  }

  it("executes multiple transfer intents from an authorized agent", async function () {
    const { agent, alice, bob, carol, batcher, token, intents } = await loadFixture(deployFixture);

    await expect(batcher.connect(agent).executeBatch(intents))
      .to.emit(batcher, "BatchExecuted")
      .withArgs(agent.address, intents.length, anyValue);

    expect(await token.balanceOf(alice.address)).to.equal(usdc(10));
    expect(await token.balanceOf(bob.address)).to.equal(usdc(5));
    expect(await token.balanceOf(carol.address)).to.equal(usdc(2));
  });

  it("blocks unregistered agents from executing batches", async function () {
    const { unauthorized, batcher, intents } = await loadFixture(deployFixture);

    await expect(batcher.connect(unauthorized).executeBatch(intents))
      .to.be.revertedWithCustomError(batcher, "UnauthorizedAgent")
      .withArgs(unauthorized.address);
  });

  it("rejects empty batches and malformed transfer intents", async function () {
    const { agent, batcher, intents } = await loadFixture(deployFixture);

    await expect(batcher.connect(agent).executeBatch([])).to.be.revertedWithCustomError(
      batcher,
      "EmptyBatch"
    );

    const malformedIntent = { ...intents[0], to: ethers.ZeroAddress };

    await expect(batcher.connect(agent).executeBatch([malformedIntent]))
      .to.be.revertedWithCustomError(batcher, "InvalidIntent")
      .withArgs(0);
  });

  it("supports registry replacement by the owner", async function () {
    const { owner, agent, batcher } = await loadFixture(deployFixture);
    const newRegistry = await ethers.deployContract("AgentRegistry", [owner.address]);
    await newRegistry.registerAgent(agent.address);

    await expect(batcher.setRegistry(await newRegistry.getAddress()))
      .to.emit(batcher, "RegistryUpdated")
      .withArgs(await newRegistry.getAddress());
  });

  it("uses less gas for three transfers batched than submitted sequentially", async function () {
    const sequential = await loadFixture(deployFixture);
    let sequentialGas = 0n;

    for (const intent of sequential.intents) {
      const tx = await sequential.batcher.connect(sequential.agent).executeBatch([intent]);
      const receipt = await tx.wait();
      sequentialGas += receipt!.gasUsed;
    }

    const batched = await deployFixture();
    const batchTx = await batched.batcher.connect(batched.agent).executeBatch(batched.intents);
    const batchReceipt = await batchTx.wait();
    const batchGas = batchReceipt!.gasUsed;

    expect(batchGas).to.be.lessThan(sequentialGas);
  });
});
