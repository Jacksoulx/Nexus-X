import { expect } from "chai";
import { ethers } from "hardhat";

describe("AgentRegistry", function () {
  async function deployFixture() {
    const [owner, agent, other] = await ethers.getSigners();
    const registry = await ethers.deployContract("AgentRegistry", [owner.address]);

    return { owner, agent, other, registry };
  }

  it("allows the owner to register and revoke agents", async function () {
    const { agent, registry } = await deployFixture();

    await expect(registry.registerAgent(agent.address))
      .to.emit(registry, "AgentRegistered")
      .withArgs(agent.address);

    expect(await registry.isAuthorized(agent.address)).to.equal(true);

    await expect(registry.revokeAgent(agent.address))
      .to.emit(registry, "AgentRevoked")
      .withArgs(agent.address);

    expect(await registry.isAuthorized(agent.address)).to.equal(false);
  });

  it("blocks non-owners from changing agent authorization", async function () {
    const { agent, other, registry } = await deployFixture();

    await expect(registry.connect(other).registerAgent(agent.address))
      .to.be.revertedWithCustomError(registry, "OwnableUnauthorizedAccount")
      .withArgs(other.address);
  });

  it("rejects the zero address", async function () {
    const { registry } = await deployFixture();

    await expect(registry.registerAgent(ethers.ZeroAddress)).to.be.revertedWithCustomError(
      registry,
      "InvalidAgent"
    );
  });
});
