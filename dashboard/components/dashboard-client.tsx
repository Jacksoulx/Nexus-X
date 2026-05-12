"use client";

import axios from "axios";
import {
  Activity,
  Blocks,
  Bot,
  CheckCircle2,
  Cpu,
  Database,
  ExternalLink,
  Gauge,
  Loader2,
  RadioTower,
  RefreshCw,
  Send,
  ShieldCheck,
  Wallet,
  Zap
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { createPublicClient, formatUnits, http, isAddress, type Address, type Hash } from "viem";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import type { ComponentType, ReactNode } from "react";
import { dashboardContracts } from "@/lib/contracts";
import type { Intent } from "../../shared/types";

type TrackerStep = "listening" | "parsing" | "queueing" | "executed";
type StepState = "idle" | "active" | "complete" | "failed";

interface BatchReceipt {
  transactionHash: string;
  blockNumber: number;
  gasUsed: string;
  intentCount: number;
}

interface FlowResult {
  intents: Intent[];
  receipt: BatchReceipt;
  source: "backend" | "mock";
}

interface DemoMetrics {
  generatedAt: string;
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

interface LocalAccountBalance {
  label: string;
  role: string;
  address: string;
  balance: string;
}

interface LocalScanTransaction {
  hash: string;
  blockNumber: string;
  from: string;
  to: string;
  gasUsed: string;
  status: "success" | "reverted" | "pending";
}

interface LocalScanState {
  status: "syncing" | "online" | "offline";
  blockNumber: string;
  chainId: string;
  balances: LocalAccountBalance[];
  transactions: LocalScanTransaction[];
  error?: string;
}

const AGENT_URL = process.env.NEXT_PUBLIC_AGENT_URL ?? "http://localhost:3001";
const BUNDLER_URL = process.env.NEXT_PUBLIC_BUNDLER_URL ?? "http://localhost:3002";
const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL ?? "http://127.0.0.1:8545";

const localClient = createPublicClient({
  transport: http(RPC_URL)
});

const demoScanAccounts = [
  { label: "Demo User", role: "Source wallet", address: dashboardContracts.deployment?.demoUser },
  { label: "Alice", role: "Recipient", address: "0x90F79bf6EB2c4f870365E785982E1f101E93b906" },
  { label: "Bob", role: "Recipient", address: "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65" },
  { label: "Carol", role: "Recipient", address: "0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc" }
];

const initialLocalScanState: LocalScanState = {
  status: "syncing",
  blockNumber: "--",
  chainId: "--",
  balances: [],
  transactions: []
};

const mockIntents: Intent[] = [
  {
    to: "0x90F79bf6EB2c4f870365E785982E1f101E93b906",
    amount: "50",
    token: "USDC"
  },
  {
    to: "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65",
    amount: "20",
    token: "USDC"
  },
  {
    to: "0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc",
    amount: "12",
    token: "USDC"
  }
];

const mockReceipt: BatchReceipt = {
  transactionHash: "0x52ad7a0cd426ee2fc4855d501b1e25b83314ac2faccf31f9feef64d9781cb4b1",
  blockNumber: 29,
  gasUsed: "144072",
  intentCount: 3
};

const tracker: Array<{ id: TrackerStep; label: string; caption: string; icon: ComponentType<{ className?: string }> }> = [
  { id: "listening", label: "Listening for Intents", caption: "Natural language command received", icon: RadioTower },
  { id: "parsing", label: "AI Parsing", caption: "Agent extracts transfers and token amounts", icon: Bot },
  { id: "queueing", label: "Queueing in Bundler", caption: "Relayer groups intents into one batch", icon: Database },
  { id: "executed", label: "Batched & Executed On-Chain", caption: "One transaction settles the batch", icon: ShieldCheck }
];

const sequentialGasPerIntent = 92000;
const chartGridColor = "rgba(142, 164, 199, 0.12)";

export function DashboardClient() {
  const [input, setInput] = useState("Send 50 USDC to Alice. Send 20 USDC to Bob. Send 12 USDC to Carol.");
  const [activeStep, setActiveStep] = useState<TrackerStep>("listening");
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<FlowResult>({
    intents: mockIntents,
    receipt: mockReceipt,
    source: "mock"
  });
  const [statusText, setStatusText] = useState("Demo data loaded. Submit an intent to call the local agent and bundler.");
  const [demoMetrics, setDemoMetrics] = useState<DemoMetrics | null>(null);
  const [localScan, setLocalScan] = useState<LocalScanState>(initialLocalScanState);
  const [scanRefreshNonce, setScanRefreshNonce] = useState(0);

  const intentCount = result.intents.length || 3;
  const seededSummary = demoMetrics?.summary;
  const batchedGas = seededSummary ? Number(seededSummary.totalBatchedGas) : Number(result.receipt.gasUsed);
  const sequentialGas = seededSummary
    ? Number(seededSummary.totalSequentialGas)
    : Math.max(intentCount * sequentialGasPerIntent, batchedGas);
  const gasSaved = seededSummary
    ? seededSummary.gasSavedPercent
    : Math.max(0, Math.round(((sequentialGas - batchedGas) / sequentialGas) * 100));
  const gasSavedLabel = `${Number.isInteger(gasSaved) ? gasSaved : gasSaved.toFixed(2)}%`;
  const gasSavedAbsolute = Math.max(0, sequentialGas - batchedGas);
  const batchedShare = sequentialGas > 0 ? Math.max(0, Math.min(100, (batchedGas / sequentialGas) * 100)) : 0;
  const savedShare = Math.max(0, Math.min(100, 100 - batchedShare));
  const maxChartGas = Math.max(sequentialGas, batchedGas);
  const chartData = useMemo(
    () => [
      {
        mode: seededSummary ? "Sequential\nWorkload" : "Sequential",
        gas: sequentialGas,
        label: sequentialGas.toLocaleString(),
        delta: 0,
        fill: "url(#sequentialGasGradient)"
      },
      {
        mode: seededSummary ? "Nexus-X\nBatches" : "Nexus-X Batch",
        gas: batchedGas,
        label: batchedGas.toLocaleString(),
        delta: gasSavedAbsolute,
        fill: "url(#batchedGasGradient)"
      }
    ],
    [batchedGas, gasSavedAbsolute, seededSummary, sequentialGas]
  );

  useEffect(() => {
    let mounted = true;

    async function loadDemoMetrics() {
      try {
        const response = await fetch("/demo-metrics.json", { cache: "no-store" });
        if (!response.ok) {
          return;
        }

        const data: unknown = await response.json();
        if (mounted && isDemoMetrics(data)) {
          setDemoMetrics(data);
        }
      } catch {
        // The dashboard still has built-in mock values when no seed artifact exists.
      }
    }

    void loadDemoMetrics();

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let mounted = true;

    async function syncLocalScan() {
      setLocalScan((current) => ({ ...current, status: "syncing", error: undefined }));

      try {
        const snapshot = await loadLocalScan();
        if (mounted) {
          setLocalScan(snapshot);
        }
      } catch (error) {
        if (mounted) {
          setLocalScan((current) => ({
            ...current,
            status: "offline",
            error: error instanceof Error ? error.message : "Unable to reach local chain RPC."
          }));
        }
      }
    }

    void syncLocalScan();
    const intervalId = window.setInterval(syncLocalScan, 5000);

    return () => {
      mounted = false;
      window.clearInterval(intervalId);
    };
  }, [scanRefreshNonce]);

  async function submitIntent() {
    setBusy(true);
    setFailed(false);
    setActiveStep("listening");
    setStatusText("Intent received. Starting local execution pipeline.");

    try {
      await pause(250);
      setActiveStep("parsing");
      const parsed = await axios.post(`${AGENT_URL}/parse-intent`, { input }, { timeout: 4500 });
      const intents = normalizeAgentResponse(parsed.data);

      setActiveStep("queueing");
      setStatusText(`Parsed ${intents.length} intent${intents.length === 1 ? "" : "s"}. Waiting for bundler receipt.`);
      const bundled = await axios.post(`${BUNDLER_URL}/enqueue-intents`, { intents }, { timeout: 12000 });
      const receipt = normalizeBundlerResponse(bundled.data);

      setResult({ intents, receipt, source: "backend" });
      setActiveStep("executed");
      setStatusText(`Executed ${receipt.intentCount} intent${receipt.intentCount === 1 ? "" : "s"} in one batched transaction.`);
      setScanRefreshNonce((value) => value + 1);
    } catch (error) {
      setFailed(true);
      setResult({ intents: mockIntents, receipt: mockReceipt, source: "mock" });
      setActiveStep("executed");
      setStatusText(`${describeRequestError(error)} Showing presentation-ready mock data.`);
    } finally {
      setBusy(false);
    }
  }

  function stepState(step: TrackerStep): StepState {
    if (failed && step === activeStep) {
      return "failed";
    }

    const activeIndex = tracker.findIndex((item) => item.id === activeStep);
    const stepIndex = tracker.findIndex((item) => item.id === step);

    if (stepIndex < activeIndex) {
      return "complete";
    }

    if (stepIndex === activeIndex) {
      return busy ? "active" : "complete";
    }

    return "idle";
  }

  return (
    <main className="relative min-h-screen overflow-hidden px-4 py-6 text-slate-100 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-5">
        <header className="relative overflow-hidden border border-circuit-cyan/25 bg-[linear-gradient(135deg,rgba(16,24,39,0.96),rgba(5,10,22,0.92)_54%,rgba(17,24,39,0.86))] p-5 shadow-data backdrop-blur lg:p-6">
          <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(115deg,transparent_0_58%,rgba(45,226,230,0.08)_58%_59%,transparent_59%),linear-gradient(245deg,rgba(168,85,247,0.13),transparent_42%)]" />
          <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-circuit-cyan to-transparent" />
          <div className="relative flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="mb-3 inline-flex items-center gap-2 border border-circuit-cyan/40 bg-circuit-cyan/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-circuit-cyan shadow-neon">
                <Activity className="h-3.5 w-3.5" />
                Nexus Execution Network
              </div>
              <h1 className="text-4xl font-semibold text-white sm:text-5xl">Nexus-X</h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-400">
                AI parsed intents, relayed through a local bundler, and measured against direct sequential execution.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <EndpointPill label="Agent" value={AGENT_URL} tone="cyan" />
                <EndpointPill label="Bundler" value={BUNDLER_URL} tone="violet" />
                <EndpointPill label="RPC" value={RPC_URL} tone="green" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3 lg:min-w-[420px]">
              <Stat label="Mode" value={result.source === "backend" ? "Live" : "Demo"} accent="cyan" />
              <Stat label="Intents" value={String(intentCount)} accent="green" />
              <Stat label="Gas Saved" value={gasSavedLabel} accent="amber" />
            </div>
          </div>
        </header>

        <section className="grid gap-5 lg:grid-cols-[1.05fr_0.95fr]">
          <Panel title="Intent Console" icon={Cpu}>
            <div className="flex h-full flex-col gap-4">
              <div className="border border-circuit-cyan/20 bg-[linear-gradient(135deg,rgba(45,226,230,0.08),rgba(2,6,23,0.32))] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 text-xs uppercase tracking-[0.14em] text-circuit-cyan">
                    <Bot className="h-3.5 w-3.5" />
                    AI Operator
                  </div>
                  <StatusDot status={busy ? "active" : "ready"} label={busy ? "Processing" : "Ready"} />
                </div>
                <p className="text-sm leading-6 text-slate-300">
                  Convert this transfer request into token intents, then send the batch to the relayer.
                </p>
              </div>
              <div className="overflow-hidden border border-circuit-line bg-slate-950/70 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                <div className="flex items-center justify-between border-b border-circuit-line bg-black/30 px-4 py-2">
                  <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-slate-500">intent.input</span>
                  <span className="font-mono text-[11px] text-circuit-cyan">natural-language</span>
                </div>
                <textarea
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  aria-label="Natural language intent input"
                  className="min-h-40 w-full resize-none bg-transparent p-4 font-mono text-sm leading-6 text-slate-100 outline-none transition placeholder:text-slate-600 focus:shadow-[inset_0_0_0_1px_rgba(45,226,230,0.55)]"
                  placeholder="Send 50 USDC to Alice and 20 USDC to Bob"
                />
              </div>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="border border-circuit-line bg-black/25 px-3 py-2 text-xs text-slate-500">
                  Contract sync: {dashboardContracts.hasLocalDeployment ? "local deployment loaded" : "ABI only"}
                </div>
                <button
                  type="button"
                  onClick={submitIntent}
                  disabled={busy || !input.trim()}
                  className="inline-flex h-11 items-center justify-center gap-2 border border-circuit-cyan bg-[linear-gradient(135deg,#2DE2E6,#72F2A1)] px-4 text-sm font-semibold text-black shadow-neon transition hover:border-white hover:brightness-110 disabled:cursor-not-allowed disabled:border-slate-700 disabled:bg-none disabled:bg-slate-800 disabled:text-slate-500 disabled:shadow-none"
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  {busy ? "Submitting" : "Submit Intent"}
                </button>
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
                {result.intents.map((intent, index) => (
                  <div key={`${intent.to}-${index}`} className="group relative overflow-hidden border border-circuit-line bg-[linear-gradient(145deg,rgba(15,23,42,0.72),rgba(2,6,23,0.72))] p-3 transition hover:border-circuit-cyan/60 hover:shadow-neon">
                    <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-circuit-cyan/0 via-circuit-cyan/50 to-circuit-cyan/0 opacity-0 transition group-hover:opacity-100" />
                    <div className="text-xs uppercase tracking-[0.16em] text-slate-500">Intent {index + 1}</div>
                    <div className="mt-2 text-xl font-semibold text-white">
                      {intent.amount} {intent.token}
                    </div>
                    <div className="mt-2 truncate font-mono text-xs text-slate-400">{intent.to}</div>
                  </div>
                ))}
              </div>
            </div>
          </Panel>

          <Panel title="Live Execution Tracker" icon={RadioTower}>
            <div className="flex flex-col gap-4">
              <div className="relative grid gap-3">
                <div className="pointer-events-none absolute bottom-6 left-[22px] top-6 w-px bg-gradient-to-b from-circuit-cyan/20 via-circuit-green/30 to-circuit-violet/20" />
                {tracker.map((item) => (
                  <TrackerRow
                    key={item.id}
                    label={item.label}
                    caption={item.caption}
                    icon={item.icon}
                    state={stepState(item.id)}
                  />
                ))}
              </div>
              <div className="border border-circuit-cyan/20 bg-[linear-gradient(145deg,rgba(45,226,230,0.07),rgba(2,6,23,0.72))] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs uppercase tracking-[0.16em] text-slate-500">Receipt</span>
                  <span className={`border px-2 py-1 text-[10px] uppercase tracking-[0.14em] ${result.source === "backend" ? "border-circuit-green/40 bg-circuit-green/10 text-circuit-green" : "border-circuit-amber/40 bg-circuit-amber/10 text-circuit-amber"}`}>
                    {result.source === "backend" ? "Live RPC" : "Mock fallback"}
                  </span>
                </div>
                <p className="mt-3 text-sm leading-6 text-slate-400">{statusText}</p>
                <div className="mt-3 break-all border border-circuit-line bg-black/30 p-3 font-mono text-xs leading-5 text-circuit-cyan">
                  {result.receipt.transactionHash}
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                  <Stat label="Block" value={String(result.receipt.blockNumber)} accent="cyan" />
                  <Stat label="Gas" value={result.receipt.gasUsed} accent="green" />
                </div>
                <a
                  href="#local-chain-scan"
                  className="mt-3 inline-flex items-center gap-2 text-xs uppercase tracking-[0.16em] text-circuit-cyan underline-offset-4 hover:underline"
                >
                  Local Chain Scan
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </div>
            </div>
          </Panel>
        </section>

        <Panel id="local-chain-scan" title="Local Chain Scan" icon={Blocks}>
          <div className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
            <div className="grid gap-3">
              <div className="grid gap-2 sm:grid-cols-3">
                <Stat label="RPC" value={scanStatusLabel(localScan.status)} accent={localScan.status === "online" ? "green" : "amber"} />
                <Stat label="Chain ID" value={localScan.chainId} accent="cyan" />
                <Stat label="Block" value={localScan.blockNumber} accent="green" />
              </div>
              <div className="flex flex-col gap-3 border border-circuit-cyan/20 bg-[linear-gradient(135deg,rgba(77,124,255,0.1),rgba(2,6,23,0.5))] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-xs uppercase tracking-[0.16em] text-slate-500">
                    <RadioTower className="h-3.5 w-3.5 text-circuit-cyan" />
                    Local RPC
                  </div>
                  <div className="mt-2 truncate font-mono text-xs text-circuit-cyan">{RPC_URL}</div>
                  {localScan.error ? <div className="mt-2 text-xs text-circuit-amber">{localScan.error}</div> : null}
                </div>
                <button
                  type="button"
                  onClick={() => setScanRefreshNonce((value) => value + 1)}
                  className="inline-flex h-10 items-center justify-center gap-2 border border-circuit-line bg-black/20 px-3 text-xs font-semibold uppercase tracking-[0.12em] text-slate-200 transition hover:border-circuit-cyan hover:bg-circuit-cyan/10 hover:text-circuit-cyan"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${localScan.status === "syncing" ? "animate-spin" : ""}`} />
                  Refresh
                </button>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {localScan.balances.map((account) => (
                  <div key={account.address} className="group relative overflow-hidden border border-circuit-line bg-[linear-gradient(145deg,rgba(16,24,39,0.78),rgba(2,6,23,0.68))] p-3 transition hover:border-circuit-green/50 hover:shadow-green">
                    <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-circuit-green/50 to-transparent opacity-0 transition group-hover:opacity-100" />
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <div className="text-sm font-semibold text-white">{account.label}</div>
                        <div className="mt-1 text-[10px] uppercase tracking-[0.14em] text-slate-500">{account.role}</div>
                      </div>
                      <Wallet className="h-4 w-4 text-circuit-green" />
                    </div>
                    <div className="mt-3 flex items-end justify-between gap-2">
                      <div className="text-2xl font-semibold text-circuit-green">{account.balance}</div>
                      <div className="pb-1 text-[10px] uppercase tracking-[0.14em] text-slate-500">USDC</div>
                    </div>
                    <div className="mt-2 truncate border-t border-circuit-line/70 pt-2 font-mono text-xs text-slate-500">{account.address}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="min-w-0 border border-circuit-line bg-[linear-gradient(145deg,rgba(15,23,42,0.72),rgba(2,6,23,0.78))] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <div className="text-xs uppercase tracking-[0.16em] text-slate-500">Recent Transactions</div>
                  <div className="mt-1 text-sm text-slate-400">Latest Hardhat blocks with mined transactions</div>
                </div>
                <div className="flex h-9 w-9 items-center justify-center border border-circuit-cyan/40 bg-circuit-cyan/10 text-circuit-cyan shadow-neon">
                  <Database className="h-4 w-4" />
                </div>
              </div>
              <div className="grid gap-2">
                {localScan.transactions.length > 0 ? (
                  localScan.transactions.map((transaction) => (
                    <div key={transaction.hash} className="grid gap-3 border border-circuit-line bg-black/25 p-3 text-xs transition hover:border-circuit-cyan/50 hover:bg-circuit-cyan/5 lg:grid-cols-[90px_1fr_110px] lg:items-center">
                      <div>
                        <div className="uppercase tracking-[0.14em] text-slate-500">Block</div>
                        <div className="mt-1 font-semibold text-circuit-cyan">{transaction.blockNumber}</div>
                      </div>
                      <div className="min-w-0">
                        <div className="truncate font-mono text-circuit-cyan">{transaction.hash}</div>
                        <div className="mt-1 truncate text-slate-500">
                          {shortAddress(transaction.from)} {"->"} {shortAddress(transaction.to)}
                        </div>
                      </div>
                      <div className="lg:text-right">
                        <div className={`inline-flex border px-2 py-1 text-[10px] uppercase tracking-[0.12em] ${transaction.status === "success" ? "border-circuit-green/40 bg-circuit-green/10 text-circuit-green" : "border-circuit-amber/40 bg-circuit-amber/10 text-circuit-amber"}`}>
                          {transaction.status}
                        </div>
                        <div className="mt-2 font-mono text-slate-500">{transaction.gasUsed} gas</div>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="border border-dashed border-circuit-line bg-black/20 p-5 text-sm text-slate-500">
                    No mined transactions found in the latest local blocks yet.
                  </div>
                )}
              </div>
            </div>
          </div>
        </Panel>

        <Panel title="Scalability & Performance Metrics" icon={Gauge} featured>
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
            <div className="relative min-w-0 overflow-hidden border border-circuit-cyan/25 bg-[linear-gradient(145deg,rgba(16,24,39,0.96),rgba(2,6,23,0.88))] p-4 shadow-data">
              <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(125deg,rgba(45,226,230,0.14),transparent_36%),linear-gradient(235deg,rgba(168,85,247,0.16),transparent_34%)]" />
              <div className="relative mb-5 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="inline-flex items-center gap-2 border border-circuit-violet/40 bg-circuit-violet/10 px-3 py-1 text-xs uppercase tracking-[0.16em] text-circuit-violet">
                    <Gauge className="h-3.5 w-3.5" />
                    Recharts Gas Analytics
                  </div>
                  <div className="mt-3 text-2xl font-semibold text-white sm:text-3xl">Save {gasSavedLabel} Gas</div>
                  <div className="mt-2 text-sm leading-6 text-slate-400">
                    Sequential execution baseline is compared against the Nexus-X batched settlement receipt.
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:min-w-64">
                  <div className="border border-circuit-rose/35 bg-circuit-rose/10 px-3 py-2">
                    <div className="text-[10px] uppercase tracking-[0.16em] text-circuit-rose">Baseline</div>
                    <div className="mt-1 font-mono text-lg font-semibold text-white">{sequentialGas.toLocaleString()}</div>
                  </div>
                  <div className="border border-circuit-green/40 bg-circuit-green/10 px-3 py-2">
                    <div className="text-[10px] uppercase tracking-[0.16em] text-circuit-green">Saved</div>
                    <div className="mt-1 font-mono text-lg font-semibold text-circuit-green">{gasSavedAbsolute.toLocaleString()}</div>
                  </div>
                </div>
              </div>
              <div className="relative h-[360px] border border-white/10 bg-black/25 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
                <div className="pointer-events-none absolute inset-x-4 top-4 z-10 flex items-center justify-between text-[10px] uppercase tracking-[0.16em] text-slate-500">
                  <span>Gas Used</span>
                  <span>Lower is better</span>
                </div>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 48, right: 18, bottom: 8, left: 0 }}>
                  <defs>
                    <linearGradient id="sequentialGasGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#FF7AAF" />
                      <stop offset="48%" stopColor="#FF4D8D" />
                      <stop offset="100%" stopColor="#5B183C" />
                    </linearGradient>
                    <linearGradient id="batchedGasGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#B7FFCF" />
                      <stop offset="45%" stopColor="#72F2A1" />
                      <stop offset="100%" stopColor="#1B6B73" />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke={chartGridColor} vertical={false} strokeDasharray="3 10" />
                  <XAxis
                    dataKey="mode"
                    stroke="#9FB3D9"
                    tickLine={false}
                    axisLine={false}
                    tick={{ fontSize: 12, fontWeight: 700 }}
                  />
                  <YAxis
                    domain={[0, Math.ceil(maxChartGas * 1.18)]}
                    stroke="#7185AA"
                    tickLine={false}
                    axisLine={false}
                    width={78}
                    tickFormatter={(value) => `${Math.round(Number(value) / 1000)}k`}
                    tick={{ fontSize: 11 }}
                  />
                  <Tooltip
                    cursor={{ fill: "rgba(45, 226, 230, 0.05)" }}
                    content={<GasTooltip />}
                  />
                  <Bar dataKey="gas" barSize={118} radius={[8, 8, 1, 1]}>
                    <LabelList dataKey="label" position="top" fill="#EEF7FF" fontSize={12} fontWeight={700} />
                    {chartData.map((entry) => (
                      <Cell key={entry.mode} fill={entry.fill} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              </div>
              <div className="relative mt-4 grid gap-3 sm:grid-cols-2">
                <GasLegend label="Direct sequential" value={sequentialGas} tone="rose" />
                <GasLegend label="Batched settlement" value={batchedGas} tone="green" />
              </div>
              <div className="relative mt-4 border border-circuit-line/80 bg-black/30 p-3">
                <div className="mb-2 flex items-center justify-between text-[10px] uppercase tracking-[0.16em] text-slate-500">
                  <span>Gas compression path</span>
                  <span>{savedShare.toFixed(2)}% saved</span>
                </div>
                <div className="flex h-3 overflow-hidden border border-circuit-line bg-slate-950">
                  <div className="bg-gradient-to-r from-circuit-green to-circuit-cyan" style={{ width: `${savedShare}%` }} />
                  <div className="bg-gradient-to-r from-circuit-violet/80 to-circuit-rose/90" style={{ width: `${batchedShare}%` }} />
                </div>
                <div className="mt-2 flex items-center justify-between font-mono text-[11px] text-slate-400">
                  <span>Saved {gasSavedAbsolute.toLocaleString()}</span>
                  <span>Used {batchedGas.toLocaleString()}</span>
                </div>
              </div>
            </div>
            <div className="grid gap-3">
              <div className="relative overflow-hidden border border-circuit-green/50 bg-[linear-gradient(145deg,rgba(114,242,161,0.16),rgba(45,226,230,0.06))] p-5 shadow-green">
                <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-circuit-green to-transparent" />
                <div className="relative flex items-center gap-2 text-xs uppercase tracking-[0.16em] text-circuit-green">
                  <Zap className="h-4 w-4" />
                  Gas Saved
                </div>
                <div className="relative mt-4 text-6xl font-semibold leading-none text-white">{gasSavedLabel}</div>
                <div className="relative mt-3 text-sm leading-6 text-slate-400">
                  Nexus-X avoids {gasSavedAbsolute.toLocaleString()} gas across this workload by settling intents in compact batches.
                </div>
                <div className="relative mt-5 h-2 border border-circuit-line bg-black/50">
                  <div
                    className="h-full bg-gradient-to-r from-circuit-green to-circuit-cyan"
                    style={{ width: `${savedShare}%` }}
                    aria-label={`${gasSavedLabel} gas saved`}
                  />
                </div>
              </div>
              <Metric icon={Activity} label="Sequential Gas" value={sequentialGas.toLocaleString()} tone="rose" />
              <Metric icon={CheckCircle2} label="Batched Gas" value={batchedGas.toLocaleString()} tone="cyan" />
              <Metric icon={Blocks} label="Batched Share" value={`${batchedShare.toFixed(1)}%`} tone="green" />
            </div>
          </div>
          <div className="mt-4 grid gap-3 border-t border-circuit-line/70 pt-4 text-xs text-slate-500 sm:grid-cols-3">
            <span>
              Dataset: {seededSummary ? "seeded local workload" : "built-in fallback estimate"}
            </span>
            <span>
              Sequential transfers: {seededSummary?.sequentialTransferCount ?? intentCount}
            </span>
            <span>
              Batched transfers: {seededSummary?.batchedTransferCount ?? intentCount}
            </span>
          </div>
        </Panel>
        <footer className="flex flex-col gap-2 border-t border-circuit-line/80 bg-black/10 px-1 pt-4 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between">
          <span>Agent: {AGENT_URL}</span>
          <span>Bundler: {BUNDLER_URL}</span>
          <span>
            Metrics: {demoMetrics ? `seeded ${new Date(demoMetrics.generatedAt).toLocaleString()}` : "fallback"}
          </span>
        </footer>
      </div>
    </main>
  );
}

function normalizeAgentResponse(data: unknown): Intent[] {
  if (Array.isArray(data) && data.every(isIntent)) {
    return data;
  }

  if (data && typeof data === "object") {
    const intents = (data as { intents?: unknown }).intents;
    if (Array.isArray(intents) && intents.every(isIntent)) {
      return intents;
    }
  }

  throw new Error("Agent response did not contain intents.");
}

function normalizeBundlerResponse(data: unknown): BatchReceipt {
  const receipts = data && typeof data === "object" ? (data as { receipts?: BatchReceipt[] }).receipts : undefined;
  const receipt = Array.isArray(receipts) ? receipts[0] : undefined;

  if (!receipt?.transactionHash || !receipt.gasUsed) {
    throw new Error("Bundler response did not contain a receipt.");
  }

  return receipt;
}

function describeRequestError(error: unknown) {
  if (axios.isAxiosError(error)) {
    const responseError = error.response?.data;
    if (responseError && typeof responseError === "object" && "error" in responseError) {
      return `Local service error: ${String(responseError.error)}.`;
    }

    if (error.code === "ERR_NETWORK") {
      return "Local services are unreachable from this dashboard origin.";
    }

    if (error.code === "ECONNABORTED") {
      return "Local service request timed out.";
    }
  }

  return "Local services are unavailable or returned an error.";
}

async function loadLocalScan(): Promise<LocalScanState> {
  const deployment = dashboardContracts.deployment;
  const tokenAddress = asAddress(deployment?.mockUSDC);

  if (!deployment || !tokenAddress) {
    throw new Error("No local MockUSDC deployment metadata is available.");
  }

  const [blockNumber, chainId] = await Promise.all([localClient.getBlockNumber(), localClient.getChainId()]);
  const balances = await Promise.all(
    demoScanAccounts.map(async (account) => {
      const address = asAddress(account.address);
      if (!address) {
        return {
          label: account.label,
          role: account.role,
          address: "unavailable",
          balance: "--"
        };
      }

      const balance = await localClient.readContract({
        address: tokenAddress,
        abi: dashboardContracts.abis.MockUSDC,
        functionName: "balanceOf",
        args: [address]
      });

      return {
        label: account.label,
        role: account.role,
        address,
        balance: formatTokenAmount(balance)
      };
    })
  );

  return {
    status: "online",
    blockNumber: blockNumber.toString(),
    chainId: String(chainId),
    balances,
    transactions: await loadRecentTransactions(blockNumber)
  };
}

async function loadRecentTransactions(latestBlockNumber: bigint): Promise<LocalScanTransaction[]> {
  const lookback = Array.from({ length: 10 }, (_, index) => latestBlockNumber - BigInt(index)).filter(
    (blockNumber) => blockNumber >= 0n
  );
  const blocks = await Promise.all(
    lookback.map((blockNumber) => localClient.getBlock({ blockNumber, includeTransactions: true }))
  );
  const transactions = blocks.flatMap((block) =>
    (block.transactions as Array<Hash | { hash: Hash; from?: string; to?: string | null }>).map((transaction) => ({
      transaction,
      blockNumber: block.number ?? 0n
    }))
  );

  return Promise.all(
    transactions.slice(0, 6).map(async ({ transaction, blockNumber }) => {
      const hash = typeof transaction === "string" ? transaction : transaction.hash;
      const receipt = await localClient.getTransactionReceipt({ hash });
      const from = typeof transaction === "string" ? receipt.from : transaction.from ?? receipt.from;
      const to = typeof transaction === "string" ? receipt.to : transaction.to ?? receipt.to;

      return {
        hash,
        blockNumber: blockNumber.toString(),
        from,
        to: to ?? "contract creation",
        gasUsed: receipt.gasUsed.toString(),
        status: receipt.status
      };
    })
  );
}

function asAddress(value: string | undefined): Address | null {
  return value && isAddress(value) ? value : null;
}

function formatTokenAmount(value: unknown) {
  if (typeof value !== "bigint") {
    return "--";
  }

  const formatted = formatUnits(value, 6);
  return formatted.replace(/\.0$/, "");
}

function scanStatusLabel(status: LocalScanState["status"]) {
  return {
    syncing: "Syncing",
    online: "Online",
    offline: "Offline"
  }[status];
}

function shortAddress(value: string) {
  if (value.length <= 14) {
    return value;
  }

  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function isIntent(value: unknown): value is Intent {
  if (!value || typeof value !== "object") {
    return false;
  }

  const intent = value as Partial<Intent>;
  return typeof intent.to === "string" && typeof intent.amount === "string" && typeof intent.token === "string";
}

function isDemoMetrics(value: unknown): value is DemoMetrics {
  if (!value || typeof value !== "object") {
    return false;
  }

  const metrics = value as Partial<DemoMetrics>;
  const summary = metrics.summary;
  return (
    typeof metrics.generatedAt === "string" &&
    Boolean(summary) &&
    typeof summary?.totalSequentialGas === "string" &&
    typeof summary?.totalBatchedGas === "string" &&
    typeof summary?.gasSavedPercent === "number"
  );
}

function pause(ms: number) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function EndpointPill({ label, value, tone }: { label: string; value: string; tone: "cyan" | "violet" | "green" }) {
  const styles = {
    cyan: "border-circuit-cyan/35 bg-circuit-cyan/10 text-circuit-cyan",
    violet: "border-circuit-violet/35 bg-circuit-violet/10 text-circuit-violet",
    green: "border-circuit-green/35 bg-circuit-green/10 text-circuit-green"
  }[tone];

  return (
    <div className={`inline-flex max-w-full items-center gap-2 border px-3 py-1 ${styles}`}>
      <span className="text-[10px] uppercase tracking-[0.14em] text-slate-400">{label}</span>
      <span className="max-w-[220px] truncate font-mono text-[11px]">{value}</span>
    </div>
  );
}

function StatusDot({ status, label }: { status: "active" | "ready"; label: string }) {
  const color = status === "active" ? "bg-circuit-amber shadow-[0_0_12px_rgba(246,196,83,0.55)]" : "bg-circuit-green shadow-[0_0_12px_rgba(114,242,161,0.55)]";

  return (
    <span className="inline-flex items-center gap-2 text-[10px] uppercase tracking-[0.14em] text-slate-400">
      <span className={`h-2 w-2 ${color}`} />
      {label}
    </span>
  );
}

function Panel({
  id,
  title,
  icon: Icon,
  children,
  featured = false
}: {
  id?: string;
  title: string;
  icon: ComponentType<{ className?: string }>;
  children: ReactNode;
  featured?: boolean;
}) {
  return (
    <section
      id={id}
      className={`relative scroll-mt-4 overflow-hidden border bg-[linear-gradient(145deg,rgba(13,18,28,0.96),rgba(2,6,23,0.9))] p-4 shadow-neon backdrop-blur sm:p-5 ${
        featured ? "border-circuit-cyan/50" : "border-circuit-line"
      }`}
    >
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(120deg,rgba(255,255,255,0.035),transparent_28%),linear-gradient(250deg,rgba(77,124,255,0.045),transparent_34%)]" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-circuit-cyan/70 to-transparent" />
      <div className="relative mb-4 flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center border border-circuit-cyan/50 bg-circuit-cyan/10 text-circuit-cyan shadow-neon">
          <Icon className="h-4 w-4" />
        </div>
        <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-200">{title}</h2>
      </div>
      <div className="relative">{children}</div>
    </section>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent: "cyan" | "green" | "amber" }) {
  const color = {
    cyan: "text-circuit-cyan",
    green: "text-circuit-green",
    amber: "text-circuit-amber"
  }[accent];

  return (
    <div className="relative overflow-hidden border border-circuit-line bg-[linear-gradient(145deg,rgba(15,23,42,0.68),rgba(2,6,23,0.68))] px-3 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />
      <div className="text-[10px] uppercase tracking-[0.14em] text-slate-500">{label}</div>
      <div className={`mt-1 text-base font-semibold ${color}`}>{value}</div>
    </div>
  );
}

function TrackerRow({
  label,
  caption,
  icon: Icon,
  state
}: {
  label: string;
  caption: string;
  icon: ComponentType<{ className?: string }>;
  state: StepState;
}) {
  const styles = {
    idle: "border-circuit-line text-slate-500",
    active: "border-circuit-cyan bg-circuit-cyan/10 text-circuit-cyan shadow-neon",
    complete: "border-circuit-green/60 bg-circuit-green/10 text-circuit-green shadow-green",
    failed: "border-circuit-amber bg-circuit-amber/10 text-circuit-amber"
  }[state];

  return (
    <div className={`relative flex items-center justify-between border bg-black/35 p-3 transition ${styles}`}>
      <div className="flex items-center gap-3">
        <div className="z-10 flex h-7 w-7 items-center justify-center border border-current bg-slate-950">
          <Icon className="h-4 w-4" />
        </div>
        <div>
          <div className="text-sm font-medium text-slate-100">{label}</div>
          <div className="mt-1 text-xs text-slate-500">{caption}</div>
        </div>
      </div>
      {state === "active" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
    </div>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
  tone
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  value: string;
  tone: "cyan" | "green" | "rose";
}) {
  const color = {
    cyan: "text-circuit-cyan",
    green: "text-circuit-green",
    rose: "text-circuit-rose"
  }[tone];

  return (
    <div className="border border-circuit-line bg-black/30 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
      <div className="flex items-center gap-2 text-xs uppercase tracking-[0.14em] text-slate-500">
        <Icon className={`h-4 w-4 ${color}`} />
        {label}
      </div>
      <div className={`mt-3 text-2xl font-semibold ${color}`}>{value}</div>
    </div>
  );
}

function GasTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ value?: number }>; label?: string }) {
  if (!active || !payload?.length) {
    return null;
  }

  const gas = Number(payload[0]?.value ?? 0);

  return (
    <div className="border border-circuit-cyan/40 bg-[#08101A]/95 px-4 py-3 shadow-neon">
      <div className="text-xs uppercase tracking-[0.16em] text-circuit-cyan">{label}</div>
      <div className="mt-2 text-xl font-semibold text-white">{gas.toLocaleString()}</div>
      <div className="mt-1 text-xs text-slate-500">gas used</div>
    </div>
  );
}

function GasLegend({ label, value, tone }: { label: string; value: number; tone: "rose" | "green" }) {
  const color = tone === "rose" ? "bg-circuit-rose" : "bg-circuit-green";
  const text = tone === "rose" ? "text-circuit-rose" : "text-circuit-green";

  return (
    <div className="flex items-center justify-between gap-3 border border-circuit-line bg-black/20 px-3 py-2">
      <div className="flex min-w-0 items-center gap-2">
        <span className={`h-2.5 w-2.5 ${color}`} />
        <span className="truncate text-xs uppercase tracking-[0.12em] text-slate-500">{label}</span>
      </div>
      <span className={`shrink-0 font-mono text-xs ${text}`}>{value.toLocaleString()}</span>
    </div>
  );
}
