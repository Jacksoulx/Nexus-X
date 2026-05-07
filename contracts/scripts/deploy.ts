import { ethers } from "hardhat";
import fs from "node:fs";
import path from "node:path";

async function main() {
  const [deployer, demoAgent, demoUser] = await ethers.getSigners();

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

  const network = await ethers.provider.getNetwork();
  const deployment = {
    network: "localhost",
    chainId: Number(network.chainId),
    deployedAt: new Date().toISOString(),
    deployer: deployer.address,
    authorizedAgent: demoAgent.address,
    demoUser: demoUser.address,
    agentRegistry: await registry.getAddress(),
    intentBatcher: await batcher.getAddress(),
    mockUSDC: await mockUsdc.getAddress()
  };

  const deploymentsDir = path.resolve(__dirname, "../deployments");
  fs.mkdirSync(deploymentsDir, { recursive: true });
  fs.writeFileSync(
    path.join(deploymentsDir, "localhost.json"),
    `${JSON.stringify(deployment, null, 2)}\n`
  );

  console.log("AI On-Chain Intent Agent Protocol contracts deployed:");
  console.log(`AgentRegistry: ${deployment.agentRegistry}`);
  console.log(`IntentBatcher: ${deployment.intentBatcher}`);
  console.log(`MockUSDC: ${deployment.mockUSDC}`);
  console.log(`Authorized demo agent: ${demoAgent.address}`);
  console.log(`Demo user: ${demoUser.address}`);
  console.log(`Deployment metadata: ${path.join(deploymentsDir, "localhost.json")}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
