import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { Contract, ethers } from "ethers";
import { IntentParser } from "./agent/src/intentParser.js";
import { IntentBundler } from "./bundler/src/bundler.js";
import { contractAbis } from "./shared/contracts.js";
import type { ContractDeployment } from "./shared/types.js";

process.env.USE_LLM_PARSER ??= "false";

const HARDHAT_AGENT_PRIVATE_KEY =
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";

function readDeployment(): ContractDeployment {
  const deploymentPath = path.resolve("shared/deployments/localhost.json");
  if (!fs.existsSync(deploymentPath)) {
    throw new Error(
      "Missing shared/deployments/localhost.json. Run a local Hardhat node, deploy contracts, then run npm run export:contracts."
    );
  }

  return JSON.parse(fs.readFileSync(deploymentPath, "utf8")) as ContractDeployment;
}

async function main() {
  const rpcUrl = process.env.RPC_URL ?? "http://127.0.0.1:8545";
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const deployment = readDeployment();

  const deployer = await provider.getSigner(0);
  const demoUser = await provider.getSigner(2);
  const alice = await provider.getSigner(3);
  const bob = await provider.getSigner(4);
  const carol = await provider.getSigner(5);

  const demoUserAddress = deployment.demoUser ?? (await demoUser.getAddress());
  const intentBatcherAddress = process.env.INTENT_BATCHER_ADDRESS ?? deployment.intentBatcher;
  const mockUsdcAddress = process.env.MOCK_USDC_ADDRESS ?? deployment.mockUSDC;
  const bundlerSignerAddress = new ethers.Wallet(HARDHAT_AGENT_PRIVATE_KEY).address;
  if (bundlerSignerAddress.toLowerCase() !== deployment.authorizedAgent.toLowerCase()) {
    throw new Error(
      `Bundler signer ${bundlerSignerAddress} does not match authorized agent ${deployment.authorizedAgent}`
    );
  }

  const token = new Contract(mockUsdcAddress, contractAbis.MockUSDC as ethers.InterfaceAbi, deployer);
  const setupAmount = ethers.parseUnits("100", 6);

  console.log("Preparing local test balances and allowance...");
  await (await token.mint(demoUserAddress, setupAmount)).wait();
  await (await (token.connect(demoUser) as Contract).approve(intentBatcherAddress, ethers.MaxUint256)).wait();

  const parser = new IntentParser();
  await parser.parse(
    [
      `Alice's address is ${await alice.getAddress()}`,
      `Bob's address is ${await bob.getAddress()}`,
      `Carol's address is ${await carol.getAddress()}`
    ].join(". ")
  );

  const parsed = await parser.parse(
    "Send 10 USDC to Alice. Send 5 USDC to Bob. Send 2 USDC to Carol."
  );

  console.log("Parsed intents:");
  console.log(JSON.stringify(parsed.intents, null, 2));

  const bundler = new IntentBundler({
    rpcUrl,
    privateKey: HARDHAT_AGENT_PRIVATE_KEY,
    intentBatcherAddress,
    defaultFromAddress: demoUserAddress,
    tokenAddresses: {
      USDC: mockUsdcAddress,
      MUSDC: mockUsdcAddress
    },
    tokenDecimals: {
      USDC: 6,
      MUSDC: 6
    },
    batchSize: 3,
    flushMs: 5000
  });

  console.log("Submitting parsed intents to bundler...");
  const receipts = await Promise.all(parsed.intents.map((intent) => bundler.enqueue(intent)));
  const batchReceipt = receipts[0];
  const chainReceipt = await provider.getTransactionReceipt(batchReceipt.transactionHash);

  console.log("Batch transaction receipt:");
  console.log({
    transactionHash: batchReceipt.transactionHash,
    blockNumber: batchReceipt.blockNumber,
    gasUsed: chainReceipt?.gasUsed.toString() ?? batchReceipt.gasUsed,
    intentCount: batchReceipt.intentCount
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
