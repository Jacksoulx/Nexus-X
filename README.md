# AI On-Chain Intent Agent Protocol

MVP for a university course project titled **AI-Powered On-Chain Agent Protocol with Intent Infrastructure**.

The system demonstrates how AI-generated user intents can be routed off-chain, batched by a relayer/bundler, and executed on-chain through a simple ERC-4337-inspired flow.

## Monorepo Layout

```text
ai-onchain-intent-agent-protocol/
├─ contracts/   # Solidity contracts, deployment scripts, Hardhat tests
├─ agent/       # AI intent parser and memory layer
├─ bundler/     # Intent queue and batch submission service
├─ dashboard/   # Next.js performance dashboard
└─ shared/      # Shared ABIs, types, and deployed addresses
```

## Step 1

The current implementation focuses on the smart-contract MVP:

- `AgentRegistry.sol` registers authorized AI agents/relayers.
- `IntentBatcher.sol` executes multiple transfer intents in one transaction.
- `MockUSDC.sol` provides a demo ERC20 token for local tests.
