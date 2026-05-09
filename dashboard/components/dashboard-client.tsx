"use client";

import axios from "axios";
import {
  Activity,
  Bot,
  CheckCircle2,
  Cpu,
  Database,
  ExternalLink,
  Gauge,
  Loader2,
  RadioTower,
  Send,
  ShieldCheck,
  Zap
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
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

const AGENT_URL = process.env.NEXT_PUBLIC_AGENT_URL ?? "http://localhost:3001";
const BUNDLER_URL = process.env.NEXT_PUBLIC_BUNDLER_URL ?? "http://localhost:3002";

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
  const chartData = useMemo(
    () => [
      { mode: seededSummary ? "Sequential Workload" : "Sequential", gas: sequentialGas, fill: "#FF4D8D" },
      { mode: seededSummary ? "Nexus-X Batches" : "Nexus-X Batch", gas: batchedGas, fill: "#72F2A1" }
    ],
    [batchedGas, seededSummary, sequentialGas]
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
    <main className="min-h-screen px-4 py-6 text-slate-100 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-5">
        <header className="flex flex-col gap-4 border-b border-circuit-line/80 pb-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="mb-2 inline-flex items-center gap-2 border border-circuit-cyan/40 bg-circuit-panel px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-circuit-cyan">
              <Activity className="h-3.5 w-3.5" />
              Nexus Execution Network
            </div>
            <h1 className="text-3xl font-semibold text-white sm:text-4xl">Nexus-X</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
              AI parsed intents, relayed through a local bundler, and measured against direct sequential execution.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
            <Stat label="Mode" value={result.source === "backend" ? "Live" : "Demo"} accent="cyan" />
            <Stat label="Intents" value={String(intentCount)} accent="green" />
            <Stat label="Gas Saved" value={gasSavedLabel} accent="amber" />
          </div>
        </header>

        <section className="grid gap-5 lg:grid-cols-[1.05fr_0.95fr]">
          <Panel title="Intent Console" icon={Cpu}>
            <div className="flex h-full flex-col gap-4">
              <div className="border border-circuit-line bg-black/25 p-3">
                <div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-[0.14em] text-slate-500">
                  <Bot className="h-3.5 w-3.5 text-circuit-cyan" />
                  AI Operator
                </div>
                <p className="text-sm leading-6 text-slate-300">
                  Convert this transfer request into token intents, then send the batch to the relayer.
                </p>
              </div>
              <textarea
                value={input}
                onChange={(event) => setInput(event.target.value)}
                aria-label="Natural language intent input"
                className="min-h-40 resize-none border border-circuit-line bg-black/30 p-4 text-sm leading-6 text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-circuit-cyan focus:shadow-neon"
                placeholder="Send 50 USDC to Alice and 20 USDC to Bob"
              />
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-xs text-slate-500">
                  Contract sync: {dashboardContracts.hasLocalDeployment ? "local deployment loaded" : "ABI only"}
                </div>
                <button
                  type="button"
                  onClick={submitIntent}
                  disabled={busy || !input.trim()}
                  className="inline-flex h-11 items-center justify-center gap-2 border border-circuit-cyan bg-circuit-cyan px-4 text-sm font-semibold text-black transition hover:bg-white disabled:cursor-not-allowed disabled:border-slate-700 disabled:bg-slate-800 disabled:text-slate-500"
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  {busy ? "Submitting" : "Submit Intent"}
                </button>
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
                {result.intents.map((intent, index) => (
                  <div key={`${intent.to}-${index}`} className="border border-circuit-line bg-black/20 p-3">
                    <div className="text-xs uppercase tracking-[0.16em] text-slate-500">Intent {index + 1}</div>
                    <div className="mt-2 text-lg font-semibold text-white">
                      {intent.amount} {intent.token}
                    </div>
                    <div className="mt-2 truncate text-xs text-slate-400">{intent.to}</div>
                  </div>
                ))}
              </div>
            </div>
          </Panel>

          <Panel title="Live Execution Tracker" icon={RadioTower}>
            <div className="flex flex-col gap-4">
              <div className="grid gap-3">
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
              <div className="border border-circuit-line bg-black/30 p-4">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs uppercase tracking-[0.16em] text-slate-500">Receipt</span>
                  <span className={result.source === "backend" ? "text-circuit-green" : "text-circuit-amber"}>
                    {result.source === "backend" ? "Live RPC" : "Mock fallback"}
                  </span>
                </div>
                <p className="mt-3 text-sm leading-6 text-slate-400">{statusText}</p>
                <div className="mt-3 break-all font-mono text-xs leading-5 text-circuit-cyan">
                  {result.receipt.transactionHash}
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                  <Stat label="Block" value={String(result.receipt.blockNumber)} accent="cyan" />
                  <Stat label="Gas" value={result.receipt.gasUsed} accent="green" />
                </div>
                <a
                  href={`http://localhost:8545/tx/${result.receipt.transactionHash}`}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-3 inline-flex items-center gap-2 text-xs uppercase tracking-[0.16em] text-circuit-cyan underline-offset-4 hover:underline"
                >
                  Local Explorer
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </div>
            </div>
          </Panel>
        </section>

        <Panel title="Scalability & Performance Metrics" icon={Gauge}>
          <div className="grid gap-5 lg:grid-cols-[1fr_300px]">
            <div className="h-72 min-w-0">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 12, right: 16, bottom: 8, left: 8 }}>
                  <CartesianGrid stroke="rgba(148, 163, 184, 0.14)" vertical={false} />
                  <XAxis dataKey="mode" stroke="#94A3B8" tickLine={false} axisLine={false} />
                  <YAxis stroke="#94A3B8" tickLine={false} axisLine={false} width={72} />
                  <Tooltip
                    cursor={{ fill: "rgba(45, 226, 230, 0.06)" }}
                    contentStyle={{
                      background: "#0D121C",
                      border: "1px solid #243041",
                      borderRadius: 0,
                      color: "#EEF7FF"
                    }}
                  />
                  <Bar dataKey="gas" radius={[2, 2, 0, 0]}>
                    {chartData.map((entry) => (
                      <Cell key={entry.mode} fill={entry.fill} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="grid gap-3">
              <Metric icon={Zap} label="Gas Saved" value={gasSavedLabel} tone="green" />
              <Metric icon={Activity} label="Sequential Gas" value={sequentialGas.toLocaleString()} tone="rose" />
              <Metric icon={CheckCircle2} label="Batched Gas" value={batchedGas.toLocaleString()} tone="cyan" />
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
        <footer className="flex flex-col gap-2 border-t border-circuit-line/80 pt-4 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between">
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

function Panel({
  title,
  icon: Icon,
  children
}: {
  title: string;
  icon: ComponentType<{ className?: string }>;
  children: ReactNode;
}) {
  return (
    <section className="border border-circuit-line bg-circuit-panel/95 p-4 shadow-neon sm:p-5">
      <div className="mb-4 flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center border border-circuit-cyan/50 bg-black/30 text-circuit-cyan">
          <Icon className="h-4 w-4" />
        </div>
        <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-200">{title}</h2>
      </div>
      {children}
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
    <div className="border border-circuit-line bg-black/25 px-3 py-2">
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
    active: "border-circuit-cyan text-circuit-cyan shadow-neon",
    complete: "border-circuit-green text-circuit-green shadow-green",
    failed: "border-circuit-amber text-circuit-amber"
  }[state];

  return (
    <div className={`flex items-center justify-between border bg-black/25 p-3 ${styles}`}>
      <div className="flex items-center gap-3">
        <Icon className="h-4 w-4" />
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
    <div className="border border-circuit-line bg-black/25 p-4">
      <div className="flex items-center gap-2 text-xs uppercase tracking-[0.14em] text-slate-500">
        <Icon className={`h-4 w-4 ${color}`} />
        {label}
      </div>
      <div className={`mt-3 text-2xl font-semibold ${color}`}>{value}</div>
    </div>
  );
}
