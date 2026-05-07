import "dotenv/config";
import { Contract, ethers } from "ethers";
import { contractAbis, localDeployment } from "../../shared/contracts.js";
import type { ChainTransferIntent, Intent } from "../../shared/types.js";

export interface BatchReceipt {
  transactionHash: string;
  blockNumber: number;
  gasUsed: string;
  intentCount: number;
}

export interface BundlerConfig {
  rpcUrl: string;
  privateKey: string;
  intentBatcherAddress: string;
  defaultFromAddress: string;
  tokenAddresses: Record<string, string>;
  tokenDecimals?: Record<string, number>;
  batchSize?: number;
  flushMs?: number;
}

interface QueuedIntent {
  intent: Intent;
  resolve: (receipt: BatchReceipt) => void;
  reject: (error: unknown) => void;
}

const DEFAULT_BATCH_SIZE = 3;
const DEFAULT_FLUSH_MS = 5000;

export class IntentBundler {
  private readonly provider: ethers.JsonRpcProvider;
  private readonly wallet: ethers.Wallet;
  private readonly batcher: Contract;
  private readonly queue: QueuedIntent[] = [];
  private flushTimer: NodeJS.Timeout | undefined;
  private readonly batchSize: number;
  private readonly flushMs: number;

  constructor(private readonly config: BundlerConfig) {
    this.provider = new ethers.JsonRpcProvider(config.rpcUrl);
    this.wallet = new ethers.Wallet(config.privateKey, this.provider);
    this.batcher = new Contract(
      config.intentBatcherAddress,
      contractAbis.IntentBatcher as ethers.InterfaceAbi,
      this.wallet
    );
    this.batchSize = config.batchSize ?? DEFAULT_BATCH_SIZE;
    this.flushMs = config.flushMs ?? DEFAULT_FLUSH_MS;
  }

  enqueue(intent: Intent) {
    const receiptPromise = new Promise<BatchReceipt>((resolve, reject) => {
      this.queue.push({ intent, resolve, reject });
    });

    if (this.queue.length >= this.batchSize) {
      void this.submitBatch();
    } else {
      this.armTimer();
    }

    return receiptPromise;
  }

  pendingCount() {
    return this.queue.length;
  }

  async submitBatch() {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = undefined;
    }

    const entries = this.queue.splice(0, this.batchSize);
    if (entries.length === 0) {
      return null;
    }

    try {
      const transfers = entries.map((entry, index) => this.toChainTransferIntent(entry.intent, index));
      const tx = await this.batcher.executeBatch(transfers);
      const receipt = await tx.wait();
      if (!receipt) {
        throw new Error(`No transaction receipt for ${tx.hash}`);
      }

      const batchReceipt: BatchReceipt = {
        transactionHash: tx.hash,
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed.toString(),
        intentCount: entries.length
      };

      for (const entry of entries) {
        entry.resolve(batchReceipt);
      }

      return batchReceipt;
    } catch (error) {
      for (const entry of entries) {
        entry.reject(error);
      }

      throw error;
    } finally {
      if (this.queue.length > 0) {
        this.armTimer();
      }
    }
  }

  private toChainTransferIntent(intent: Intent, index: number): ChainTransferIntent {
    const tokenAddress = this.resolveToken(intent.token);
    const tokenSymbol = this.normalizeTokenSymbol(intent.token);
    const decimals = this.config.tokenDecimals?.[tokenSymbol] ?? 6;
    const amount = ethers.parseUnits(intent.amount, decimals);

    if (!ethers.isAddress(intent.to)) {
      throw new Error(`Invalid recipient address: ${intent.to}`);
    }

    if (!ethers.isAddress(this.config.defaultFromAddress)) {
      throw new Error(`Invalid DEFAULT_FROM_ADDRESS: ${this.config.defaultFromAddress}`);
    }

    return {
      token: tokenAddress,
      from: this.config.defaultFromAddress,
      to: intent.to,
      amount: amount.toString(),
      userOpHash: ethers.id(`${Date.now()}:${index}:${JSON.stringify(intent)}`)
    };
  }

  private resolveToken(token: string) {
    if (ethers.isAddress(token)) {
      return token;
    }

    const symbol = this.normalizeTokenSymbol(token);
    const tokenAddress = this.config.tokenAddresses[symbol];
    if (!tokenAddress || !ethers.isAddress(tokenAddress)) {
      throw new Error(`Unknown token ${token}. Configure ${symbol}_ADDRESS or MOCK_USDC_ADDRESS.`);
    }

    return tokenAddress;
  }

  private normalizeTokenSymbol(token: string) {
    return token.trim().toUpperCase();
  }

  private armTimer() {
    if (this.flushTimer) {
      return;
    }

    this.flushTimer = setTimeout(() => {
      void this.submitBatch().catch((error) => {
        console.error("Batch submission failed:", error);
      });
    }, this.flushMs);
  }
}

export function loadBundlerConfigFromEnv(): BundlerConfig {
  const mockUsdc = process.env.MOCK_USDC_ADDRESS ?? localDeployment?.mockUSDC;
  const intentBatcherAddress = process.env.INTENT_BATCHER_ADDRESS ?? localDeployment?.intentBatcher;

  if (!process.env.BUNDLER_PRIVATE_KEY) {
    throw new Error("Missing BUNDLER_PRIVATE_KEY");
  }

  if (!intentBatcherAddress) {
    throw new Error("Missing INTENT_BATCHER_ADDRESS and no shared localhost deployment was exported.");
  }

  if (!mockUsdc) {
    throw new Error("Missing MOCK_USDC_ADDRESS and no shared localhost deployment was exported.");
  }

  if (!process.env.DEFAULT_FROM_ADDRESS) {
    throw new Error("Missing DEFAULT_FROM_ADDRESS");
  }

  return {
    rpcUrl: process.env.RPC_URL ?? "http://127.0.0.1:8545",
    privateKey: process.env.BUNDLER_PRIVATE_KEY,
    intentBatcherAddress,
    defaultFromAddress: process.env.DEFAULT_FROM_ADDRESS,
    tokenAddresses: {
      USDC: mockUsdc,
      MUSDC: mockUsdc
    },
    tokenDecimals: {
      USDC: 6,
      MUSDC: 6
    },
    batchSize: Number(process.env.BATCH_SIZE ?? DEFAULT_BATCH_SIZE),
    flushMs: Number(process.env.FLUSH_MS ?? DEFAULT_FLUSH_MS)
  };
}
