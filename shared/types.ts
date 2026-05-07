export interface Intent {
  to: string;
  amount: string;
  token: string;
}

export interface ChainTransferIntent {
  token: string;
  from: string;
  to: string;
  amount: string;
  userOpHash: string;
}

export interface ContractDeployment {
  network: string;
  chainId: number;
  deployedAt: string;
  deployer: string;
  authorizedAgent: string;
  demoUser?: string;
  agentRegistry: string;
  intentBatcher: string;
  mockUSDC: string;
}

export type ContractName = "AgentRegistry" | "IntentBatcher" | "MockUSDC";

export interface ExportedContractMetadata {
  deployment: ContractDeployment | null;
  abis: Record<ContractName, unknown[]>;
}
