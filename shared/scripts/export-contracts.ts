import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ContractDeployment, ContractName } from "../types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");
const contractsRoot = path.join(repoRoot, "contracts");
const sharedRoot = path.join(repoRoot, "shared");

const contractNames: ContractName[] = ["AgentRegistry", "IntentBatcher", "MockUSDC"];

function readArtifact(contractName: ContractName) {
  const artifactPath = path.join(
    contractsRoot,
    "artifacts",
    "contracts",
    `${contractName}.sol`,
    `${contractName}.json`
  );

  if (!fs.existsSync(artifactPath)) {
    throw new Error(`Missing artifact for ${contractName}. Run npm run compile:contracts first.`);
  }

  const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8")) as { abi?: unknown[] };
  if (!Array.isArray(artifact.abi)) {
    throw new Error(`Artifact for ${contractName} does not contain an ABI array.`);
  }

  return artifact.abi;
}

function readDeployment(): ContractDeployment | null {
  const deploymentPath = path.join(contractsRoot, "deployments", "localhost.json");
  if (!fs.existsSync(deploymentPath)) {
    return null;
  }

  return JSON.parse(fs.readFileSync(deploymentPath, "utf8")) as ContractDeployment;
}

const abis = Object.fromEntries(contractNames.map((name) => [name, readArtifact(name)])) as Record<
  ContractName,
  unknown[]
>;
const deployment = readDeployment();

fs.mkdirSync(path.join(sharedRoot, "abis"), { recursive: true });
fs.mkdirSync(path.join(sharedRoot, "deployments"), { recursive: true });

for (const [contractName, abi] of Object.entries(abis)) {
  fs.writeFileSync(
    path.join(sharedRoot, "abis", `${contractName}.json`),
    `${JSON.stringify(abi, null, 2)}\n`
  );
}

if (deployment) {
  fs.writeFileSync(
    path.join(sharedRoot, "deployments", "localhost.json"),
    `${JSON.stringify(deployment, null, 2)}\n`
  );
}

const generatedSource = `import type { ExportedContractMetadata } from "./types.js";

export const contractMetadata: ExportedContractMetadata = ${JSON.stringify({ deployment, abis }, null, 2)};

export const contractAbis = contractMetadata.abis;
export const localDeployment = contractMetadata.deployment;
`;

fs.writeFileSync(path.join(sharedRoot, "contracts.ts"), generatedSource);

console.log(
  deployment
    ? "Exported ABIs and localhost deployment metadata to shared/."
    : "Exported ABIs to shared/. No localhost deployment found; run contracts deploy:local to export addresses."
);
