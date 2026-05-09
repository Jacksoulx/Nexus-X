import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { Contract, ethers } from "ethers";
import { contractAbis } from "../shared/contracts.js";
import type { ContractDeployment } from "../shared/types.js";

interface GasSample {
  label: string;
  transactionHash: string;
  blockNumber: number;
  gasUsed: string;
  transferCount: number;
}

interface DemoMetrics {
  generatedAt: string;
  network: string;
  chainId: number;
  token: string;
  sequentialTransfers: GasSample[];
  batchedExecutions: GasSample[];
  summary: {
    sequentialTransferCount: number;
    batchedTransferCount: number;
    totalSequentialGas: string;
    totalBatchedGas: string;
    averageSequentialGas: string;
    averageBatchedGasPerTransfer: string;
    gasSavedPercent: number;
  };
}

const HARDHAT_AGENT_PRIVATE_KEY =
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";

const usdc = (value: string) => ethers.parseUnits(value, 6);

function readDeployment(): ContractDeployment {
  const candidates = [
    path.resolve("shared/deployments/localhost.json"),
    path.resolve("contracts/deployments/localhost.json")
  ];

  const deploymentPath = candidates.find((candidate) => fs.existsSync(candidate));
  if (!deploymentPath) {
    throw new Error(
      "Missing localhost deployment metadata. Start a Hardhat node, run npm --workspace contracts run deploy:local, then npm run export:contracts."
    );
  }

  return JSON.parse(fs.readFileSync(deploymentPath, "utf8")) as ContractDeployment;
}

function sampleFromReceipt(label: string, receipt: ethers.TransactionReceipt, transferCount: number): GasSample {
  return {
    label,
    transactionHash: receipt.hash,
    blockNumber: receipt.blockNumber,
    gasUsed: receipt.gasUsed.toString(),
    transferCount
  };
}

function buildIntent(token: string, from: string, to: string, amount: bigint, label: string) {
  return {
    token,
    from,
    to,
    amount,
    userOpHash: ethers.id(label)
  };
}

function sumGas(samples: GasSample[]) {
  return samples.reduce((total, sample) => total + BigInt(sample.gasUsed), 0n);
}

async function waitForReceipt(tx: ethers.ContractTransactionResponse) {
  const receipt = await tx.wait();
  if (!receipt) {
    throw new Error(`No receipt returned for ${tx.hash}`);
  }

  return receipt;
}

async function main() {
  const rpcUrl = process.env.RPC_URL ?? "http://127.0.0.1:8545";
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const deployment = readDeployment();

  const network = await provider.getNetwork();
  if (Number(network.chainId) !== deployment.chainId) {
    throw new Error(
      `Connected to chain ${network.chainId}, but deployment metadata is for chain ${deployment.chainId}.`
    );
  }

  const deployer = await provider.getSigner(0);
  const agentSigner = process.env.BUNDLER_PRIVATE_KEY
    ? new ethers.Wallet(process.env.BUNDLER_PRIVATE_KEY, provider)
    : await provider.getSigner(1);
  const agentAddress = await agentSigner.getAddress();
  const demoUser = await provider.getSigner(2);
  const recipients = await Promise.all([3, 4, 5, 6, 7, 8, 9, 10].map((index) => provider.getSigner(index)));
  const recipientAddresses = await Promise.all(recipients.map((recipient) => recipient.getAddress()));

  if (agentAddress.toLowerCase() !== deployment.authorizedAgent.toLowerCase()) {
    throw new Error(
      `Bundler signer ${agentAddress} does not match authorized agent ${deployment.authorizedAgent}.`
    );
  }

  const demoUserAddress = deployment.demoUser ?? (await demoUser.getAddress());
  const token = new Contract(deployment.mockUSDC, contractAbis.MockUSDC as ethers.InterfaceAbi, deployer);
  const userToken = token.connect(demoUser) as Contract;
  const batcher = new Contract(
    deployment.intentBatcher,
    contractAbis.IntentBatcher as ethers.InterfaceAbi,
    agentSigner
  );

  const fundingAmount = usdc("1000");
  console.log("Funding local demo accounts with MockUSDC...");
  await waitForReceipt(await token.mint(demoUserAddress, fundingAmount));

  for (const address of recipientAddresses.slice(0, 5)) {
    await waitForReceipt(await token.mint(address, usdc("25")));
  }

  console.log("Approving IntentBatcher for demo workload...");
  await waitForReceipt(await userToken.approve(deployment.intentBatcher, fundingAmount));

  console.log("Executing sequential single-intent workload...");
  const sequentialAmounts = ["4", "7", "3", "9", "5", "6", "8", "2"];
  const sequentialTransfers: GasSample[] = [];

  for (const [index, amount] of sequentialAmounts.entries()) {
    const intent = buildIntent(
      deployment.mockUSDC,
      demoUserAddress,
      recipientAddresses[index],
      usdc(amount),
      `nexus-x-demo-sequential-${index + 1}`
    );
    const tx = await batcher.executeBatch([intent]);
    const receipt = await waitForReceipt(tx);
    sequentialTransfers.push(sampleFromReceipt(`Sequential single-intent execution ${index + 1}`, receipt, 1));
  }

  console.log("Executing Nexus-X batched workload...");
  const batchedExecutions: GasSample[] = [];
  const batchDefinitions = [
    [
      ["11", recipientAddresses[0]],
      ["13", recipientAddresses[1]],
      ["17", recipientAddresses[2]]
    ],
    [
      ["19", recipientAddresses[3]],
      ["23", recipientAddresses[4]],
      ["29", recipientAddresses[5]]
    ],
    [
      ["31", recipientAddresses[6]],
      ["37", recipientAddresses[7]]
    ]
  ] as const;

  for (const [batchIndex, batch] of batchDefinitions.entries()) {
    const intents = batch.map(([amount, to], intentIndex) =>
      buildIntent(
        deployment.mockUSDC,
        demoUserAddress,
        to,
        usdc(amount),
        `nexus-x-demo-batch-${batchIndex + 1}-intent-${intentIndex + 1}`
      )
    );
    const tx = await batcher.executeBatch(intents);
    const receipt = await waitForReceipt(tx);
    batchedExecutions.push(sampleFromReceipt(`Nexus-X batch ${batchIndex + 1}`, receipt, intents.length));
  }

  const totalSequentialGas = sumGas(sequentialTransfers);
  const totalBatchedGas = sumGas(batchedExecutions);
  const sequentialTransferCount = sequentialTransfers.reduce((count, sample) => count + sample.transferCount, 0);
  const batchedTransferCount = batchedExecutions.reduce((count, sample) => count + sample.transferCount, 0);
  const averageSequentialGas = totalSequentialGas / BigInt(sequentialTransferCount);
  const averageBatchedGasPerTransfer = totalBatchedGas / BigInt(batchedTransferCount);
  const gasSavedPercent = Number(
    ((averageSequentialGas - averageBatchedGasPerTransfer) * 10000n) / averageSequentialGas
  ) / 100;

  const metrics: DemoMetrics = {
    generatedAt: new Date().toISOString(),
    network: deployment.network,
    chainId: deployment.chainId,
    token: deployment.mockUSDC,
    sequentialTransfers,
    batchedExecutions,
    summary: {
      sequentialTransferCount,
      batchedTransferCount,
      totalSequentialGas: totalSequentialGas.toString(),
      totalBatchedGas: totalBatchedGas.toString(),
      averageSequentialGas: averageSequentialGas.toString(),
      averageBatchedGasPerTransfer: averageBatchedGasPerTransfer.toString(),
      gasSavedPercent
    }
  };

  const dashboardPublicDir = path.resolve("dashboard/public");
  fs.mkdirSync(dashboardPublicDir, { recursive: true });
  fs.writeFileSync(
    path.join(dashboardPublicDir, "demo-metrics.json"),
    `${JSON.stringify(metrics, null, 2)}\n`
  );

  console.log("Demo metrics written to dashboard/public/demo-metrics.json");
  console.log({
    sequentialTransfers: sequentialTransferCount,
    batchedTransfers: batchedTransferCount,
    totalSequentialGas: metrics.summary.totalSequentialGas,
    totalBatchedGas: metrics.summary.totalBatchedGas,
    gasSavedPercent: metrics.summary.gasSavedPercent
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
