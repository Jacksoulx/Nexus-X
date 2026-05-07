import { ethers } from "hardhat";

async function main() {
  const [deployer, demoAgent] = await ethers.getSigners();

  const registry = await ethers.deployContract("AgentRegistry", [deployer.address]);
  await registry.waitForDeployment();

  const batcher = await ethers.deployContract("IntentBatcher", [
    deployer.address,
    await registry.getAddress()
  ]);
  await batcher.waitForDeployment();

  const mockUsdc = await ethers.deployContract("MockUSDC", [deployer.address]);
  await mockUsdc.waitForDeployment();

  await (await registry.registerAgent(demoAgent.address)).wait();

  console.log("AI On-Chain Intent Agent Protocol contracts deployed:");
  console.log(`AgentRegistry: ${await registry.getAddress()}`);
  console.log(`IntentBatcher: ${await batcher.getAddress()}`);
  console.log(`MockUSDC: ${await mockUsdc.getAddress()}`);
  console.log(`Authorized demo agent: ${demoAgent.address}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
