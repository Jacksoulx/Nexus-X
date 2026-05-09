# Nexus-X: AI-Powered On-Chain Agent Protocol

Nexus-X is a university MVP for an AI-assisted blockchain execution network. It demonstrates how natural-language user requests can be converted into structured transfer intents, queued by an off-chain relayer, and executed on-chain as compact batches through Solidity smart contracts.

The project combines four working components:

- Smart contracts for agent authorization, ERC20 demo liquidity, and batched execution.
- A TypeScript AI/NLP agent that parses natural-language transfer instructions into structured intents.
- A relayer/bundler service that queues intents and submits them to the blockchain.
- A Next.js performance dashboard for demonstrating execution status and gas-efficiency gains.

## Background & Problem Statement

AI agents are increasingly capable of producing autonomous, high-frequency blockchain actions: portfolio rebalancing, payment routing, DeFi maintenance, recurring transfers, and automated treasury operations. If every generated action is submitted as an independent transaction, traditional execution pipelines face three practical bottlenecks:

- Gas overhead is repeated for every action, even when several actions are logically part of the same workflow [cite: 8].
- Blockspace demand rises quickly as AI agents scale from occasional assistants to persistent transaction producers [cite: 9].
- Users and developers lose the ability to reason about multi-step outcomes because execution is fragmented across many individual transactions.

Nexus-X addresses this problem with an intent-centric model. Instead of pushing every action directly on-chain, the user expresses a goal in natural language. The system converts that goal into structured intents, batches compatible intents off-chain, and executes the batch through a single authorized on-chain call.

## Architecture Overview

```text
User
  |
  | natural-language instruction
  v
NLP Agent
  |
  | structured Intent[]
  v
Bundler / Relayer Queue
  |
  | batched TransferIntent[]
  v
IntentBatcher Smart Contract
  |
  | ERC20 transferFrom calls
  v
Recipients
```

### 1. NLP Agent

The agent service exposes `POST /parse-intent`. It accepts text such as:

```text
Send 50 USDC to Alice. Send 20 USDC to Bob. Send 12 USDC to Carol.
```

It returns structured intents:

```json
[
  { "to": "0x...", "amount": "50", "token": "USDC" },
  { "to": "0x...", "amount": "20", "token": "USDC" }
]
```

For reliable local demonstrations, the parser can run without an external LLM by using deterministic alias memory and rule-based extraction.

### 2. Bundler / Relayer

The bundler service exposes `POST /enqueue-intents`. It receives parsed intents, stores them in an in-memory queue, converts token symbols into deployed token addresses, and submits a batch when either:

- the queue reaches the configured batch size, or
- the flush timer expires.

This mirrors the high-level role of an account-abstraction bundler: it accepts user operations off-chain, aggregates work, and sends fewer on-chain transactions [cite: 15].

### 3. Smart Contracts

The Solidity layer contains three contracts:

- `AgentRegistry.sol`: stores which relayer or AI-agent addresses are authorized to execute batches.
- `IntentBatcher.sol`: accepts an array of transfer intents and executes them in one transaction.
- `MockUSDC.sol`: local ERC20 token used for repeatable testing and presentation demos.

`IntentBatcher` only accepts calls from registered agents. This keeps the MVP simple while making the trust boundary explicit: users approve the batcher to move tokens, and only authorized relayers can trigger batched execution.

### 4. Performance Dashboard

The Next.js dashboard visualizes:

- natural-language intent submission,
- live pipeline status,
- transaction receipt data,
- sequential gas usage versus Nexus-X batched gas usage,
- percentage gas saved.

If the local agent or bundler is offline, the dashboard falls back to mock data so the presentation flow remains stable.

## Monorepo Layout

```text
Nexus-X/
|-- agent/        # NLP intent parser and HTTP server
|-- bundler/      # In-memory intent queue and relayer server
|-- contracts/    # Solidity contracts, Hardhat tests, deployment script
|-- dashboard/    # Next.js App Router performance dashboard
|-- scripts/      # Root-level demo and data seeding scripts
|-- shared/       # Shared types, exported ABIs, deployment metadata
|-- test-flow.ts  # Local E2E flow across parser, bundler, and contracts
```

## Quick Start Guide

### Prerequisites

- Node.js 20 or newer
- npm
- Git

### 1. Install dependencies

```bash
npm install
```

### 2. Compile contracts

```bash
npm run compile:contracts
```

### 3. Start a local Hardhat node

Open a terminal:

```bash
npm --workspace contracts exec hardhat node
```

Keep this terminal running.

### 4. Deploy contracts to localhost

Open a second terminal:

```bash
npm --workspace contracts run deploy:local
npm run export:contracts
```

The deployment metadata is exported into `shared/deployments/localhost.json` and `shared/contracts.ts`.

### 5. Seed the demo workload

```bash
npm run demo:seed
```

This script funds local accounts with `MockUSDC`, executes sequential transfers, executes batched transfers through `IntentBatcher`, and writes dashboard-ready gas metrics to:

```text
dashboard/public/demo-metrics.json
```

### 6. Start the agent server

Open a third terminal:

```bash
npm run dev:agent
```

Default URL:

```text
http://localhost:3001
```

### 7. Start the bundler server

Open a fourth terminal:

```bash
$env:BUNDLER_PRIVATE_KEY="0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"
$env:DEFAULT_FROM_ADDRESS="<demoUser from shared/deployments/localhost.json>"
npm run dev:bundler
```

Default URL:

```text
http://localhost:3002
```

On macOS or Linux, use `export BUNDLER_PRIVATE_KEY=...` and `export DEFAULT_FROM_ADDRESS=...` instead of PowerShell `$env:`.

### 8. Launch the dashboard

```bash
npm run dev:dashboard
```

Open:

```text
http://localhost:3000
```

### 9. Run verification tests

```bash
npm run test:contracts
npm run test:flow
npm run test:qa-agent
npm run build:dashboard
```

## AI Agent Boundary QA Record

Role B system testing focused on the AI Agent parser and the project fallback path. The deterministic parser was used for repeatable QA so results do not depend on external LLM availability.

Test command:

```bash
npm run test:qa-agent
```

Latest result on 2026-05-09:

```text
AI Agent boundary QA: 12/12 cases passed
```

| ID | Boundary case | Input summary | Expected system behavior | Verified result |
| --- | --- | --- | --- | --- |
| QA-AI-01 | Valid multi-intent prompt | `Send 50 USDC to Alice. Send 20 USDC to Bob. Send 12 USDC to Carol.` | Resolve known aliases and return three structured intents. | PASS: three intents returned. |
| QA-AI-02 | Direct EVM address with decimal amount | `Send 0.5 usdc to 0x90F...b906.` | Accept direct address, preserve decimal amount, normalize token casing. | PASS: one `USDC` intent returned. |
| QA-AI-03 | Alias learning in same prompt | `Dave address is 0x3C44...93BC. Send 3 USDC to Dave.` | Learn alias before parsing transfer. | PASS: `Dave` resolved to the supplied address. |
| QA-AI-04 | Non-transfer instruction | `What is the gas saving for the latest batch?` | Do not invent a transfer; return an empty intent list. | PASS: empty list returned as safe no-op fallback. |
| QA-AI-05 | Empty instruction | Empty string | Parser returns no intents; HTTP route separately returns `400 Missing input`. | PASS: parser no-op behavior verified. |
| QA-AI-06 | Unknown recipient alias | `Send 10 USDC to Mallory.` | Reject unresolved aliases. | PASS: `Unknown recipient alias or invalid address`. |
| QA-AI-07 | Invalid address format | `Send 10 USDC to 0x1234.` | Reject malformed recipient address. | PASS: invalid address rejected before bundler submission. |
| QA-AI-08 | Malformed transfer grammar | `Send USDC 10 Alice.` | Fail closed when amount/token/order cannot be parsed. | PASS: `Could not parse transfer intent`. |
| QA-AI-09 | Negative amount | `Send -5 USDC to Alice.` | Reject negative values. | PASS: negative amount does not match parser grammar. |
| QA-AI-10 | Zero amount | `Send 0 USDC to Alice.` | Agent may parse syntactically; smart contract fallback rejects zero amount as `InvalidIntent`. | PASS: agent behavior documented; downstream guard required. |
| QA-AI-11 | Unsupported token symbol | `Send 1 ETH to Alice.` | Agent extracts symbol; bundler rejects symbols not mapped to deployed token addresses. | PASS: agent behavior documented; bundler guard required. |
| QA-AI-12 | Excessive amount | `Send 999999999 USDC to Alice.` | Agent parses number; ERC20 balance/allowance checks reject impossible execution. | PASS: agent behavior documented; chain guard required. |

QA findings:

- The Agent fails closed for unknown aliases, malformed addresses, malformed transfer syntax, and negative amounts.
- Non-transfer prompts and blank parser input degrade to an empty intent list instead of generating fake transfers.
- Zero, unsupported-token, and excessive-amount cases are intentionally handled by downstream bundler or contract checks because the Agent only converts natural language into candidate intents.
- QA uncovered and fixed a fallback-parser bug where decimal amounts such as `0.5` were incorrectly split at the decimal point during sentence segmentation.

## Demo Flow for Presentation

Recommended recording sequence:

1. Start the Hardhat node.
2. Deploy contracts and export metadata.
3. Run `npm run demo:seed`.
4. Start the agent, bundler, and dashboard.
5. Open `http://localhost:3000`.
6. Submit the default prompt:

```text
Send 50 USDC to Alice. Send 20 USDC to Bob. Send 12 USDC to Carol.
```

The dashboard will show the intent pipeline, receipt hash, and gas comparison. If the local backend is not available, the UI still displays polished mock data for a stable demo.

## Academic Analysis

### Design Trade-offs & The Blockchain Trilemma

Nexus-X improves scalability by moving coordination off-chain and compressing multiple user intents into fewer on-chain transactions. This reduces repeated transaction overhead, lowers aggregate gas consumption, and improves throughput for workflows that contain several compatible transfers.

From the blockchain trilemma perspective, this is an intentional trade-off:

- Scalability: batching improves effective throughput because one on-chain transaction can settle several intents. The dashboard and tests demonstrate lower total gas usage for a batch than for multiple independent executions.
- Decentralization: the MVP uses a trusted, centralized relayer address registered in `AgentRegistry`. This is simpler and appropriate for a course prototype, but it is less decentralized than a permissionless bundler market.
- Security and trust: users must trust that the authorized bundler submits valid batches and does not censor or delay intents. The smart contract limits execution to valid ERC20 transfers and registered agents, but it does not yet provide permissionless challenge mechanisms, slashing, or decentralized relayer selection.

This design shows why intent systems are powerful but not free. They can improve execution efficiency [cite: 23], yet they introduce new trust assumptions around off-chain actors and ordering policies [cite: 252]. A production-grade version of Nexus-X would need to decentralize the bundler layer, add user signatures over intents, include replay protection, and provide transparent mempool or auction rules.

## Security Model and Limitations

Current MVP assumptions:

- The local Hardhat chain is trusted.
- The registered bundler key is trusted.
- The demo user has approved `IntentBatcher` to spend `MockUSDC`.
- The parser is intended for controlled demo prompts, not adversarial natural language.
- The queue is in-memory and is not durable across server restarts.

Important production improvements:

- user-signed intents,
- nonce and expiry validation,
- persistent queue storage,
- decentralized relayer selection,
- formal authorization policies,
- monitoring and replay protection,
- stronger NLP validation and human confirmation for high-value transfers.

## Key Commands

```bash
npm install
npm run compile:contracts
npm --workspace contracts exec hardhat node
npm --workspace contracts run deploy:local
npm run export:contracts
npm run demo:seed
npm run dev:agent
npm run dev:bundler
npm run dev:dashboard
npm run test:contracts
npm run test:flow
npm run test:qa-agent
npm run build:dashboard
```

## Project Status

Nexus-X is a complete local MVP:

- Smart contracts compile and pass tests.
- Local deployment metadata is exported to the shared package.
- Agent and bundler servers expose working HTTP endpoints.
- End-to-end local flow passes through parser, bundler, and on-chain execution.
- Dashboard renders live and fallback presentation data.
- Demo seeding generates repeatable gas metrics for the course video.
