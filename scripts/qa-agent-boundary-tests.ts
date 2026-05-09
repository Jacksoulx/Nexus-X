process.env.USE_LLM_PARSER = "false";

type ExpectedKind = "success" | "empty" | "error";

interface BoundaryCase {
  id: string;
  category: string;
  input: string;
  setup?: Record<string, string>;
  expected: ExpectedKind;
  expectedCount?: number;
  expectedError?: string;
  note: string;
}

interface BoundaryResult extends BoundaryCase {
  actual: string;
  passed: boolean;
}

const demoAliases = {
  Alice: "0x90F79bf6EB2c4f870365E785982E1f101E93b906",
  Bob: "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65",
  Carol: "0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc"
};

const cases: BoundaryCase[] = [
  {
    id: "QA-AI-01",
    category: "valid multi-intent",
    input: "Send 50 USDC to Alice. Send 20 USDC to Bob. Send 12 USDC to Carol.",
    setup: demoAliases,
    expected: "success",
    expectedCount: 3,
    note: "Agent resolves known aliases and returns three structured intents."
  },
  {
    id: "QA-AI-02",
    category: "direct address",
    input: "Send 0.5 usdc to 0x90F79bf6EB2c4f870365E785982E1f101E93b906.",
    expected: "success",
    expectedCount: 1,
    note: "Agent accepts direct EVM addresses, decimal amounts, and normalizes token casing."
  },
  {
    id: "QA-AI-03",
    category: "alias learning",
    input:
      "Dave address is 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC. Send 3 USDC to Dave.",
    expected: "success",
    expectedCount: 1,
    note: "Agent learns an alias from the same prompt before resolving the transfer."
  },
  {
    id: "QA-AI-04",
    category: "non-transfer instruction",
    input: "What is the gas saving for the latest batch?",
    setup: demoAliases,
    expected: "empty",
    expectedCount: 0,
    note: "Fallback parser returns an empty intent list instead of inventing a transfer."
  },
  {
    id: "QA-AI-05",
    category: "empty instruction",
    input: "",
    setup: demoAliases,
    expected: "empty",
    expectedCount: 0,
    note: "Parser treats blank text as no-op; HTTP server separately returns 400 for missing input."
  },
  {
    id: "QA-AI-06",
    category: "unknown alias",
    input: "Send 10 USDC to Mallory.",
    setup: demoAliases,
    expected: "error",
    expectedError: "Unknown recipient alias",
    note: "Agent rejects recipient names that are not present in alias memory."
  },
  {
    id: "QA-AI-07",
    category: "invalid address",
    input: "Send 10 USDC to 0x1234.",
    setup: demoAliases,
    expected: "error",
    expectedError: "Unknown recipient alias or invalid address",
    note: "Agent rejects malformed EVM addresses before they reach the bundler."
  },
  {
    id: "QA-AI-08",
    category: "malformed transfer syntax",
    input: "Send USDC 10 Alice.",
    setup: demoAliases,
    expected: "error",
    expectedError: "Could not parse transfer intent",
    note: "Fallback parser fails closed when the transfer grammar is ambiguous."
  },
  {
    id: "QA-AI-09",
    category: "negative amount",
    input: "Send -5 USDC to Alice.",
    setup: demoAliases,
    expected: "error",
    expectedError: "Could not parse transfer intent",
    note: "Negative values do not match the parser amount grammar."
  },
  {
    id: "QA-AI-10",
    category: "zero amount",
    input: "Send 0 USDC to Alice.",
    setup: demoAliases,
    expected: "success",
    expectedCount: 1,
    note: "Agent currently accepts zero syntactically; IntentBatcher rejects zero amount as InvalidIntent."
  },
  {
    id: "QA-AI-11",
    category: "unsupported token",
    input: "Send 1 ETH to Alice.",
    setup: demoAliases,
    expected: "success",
    expectedCount: 1,
    note: "Agent extracts the token symbol; bundler later rejects unknown token symbols not mapped to MockUSDC."
  },
  {
    id: "QA-AI-12",
    category: "excessive amount",
    input: "Send 999999999 USDC to Alice.",
    setup: demoAliases,
    expected: "success",
    expectedCount: 1,
    note: "Agent accepts large numeric values; ERC20 balance/allowance checks reject impossible execution."
  }
];

async function buildParser(setup: Record<string, string> = {}) {
  const { AliasMemory } = await import("../agent/src/memory.js");
  const { IntentParser } = await import("../agent/src/intentParser.js");
  const memory = new AliasMemory();
  for (const [alias, address] of Object.entries(setup)) {
    memory.remember(alias, address);
  }

  return new IntentParser(memory);
}

async function runCase(testCase: BoundaryCase): Promise<BoundaryResult> {
  const parser = await buildParser(testCase.setup);

  try {
    const parsed = await parser.parse(testCase.input);
    const actualKind: ExpectedKind = parsed.intents.length === 0 ? "empty" : "success";
    const countMatches =
      testCase.expectedCount === undefined || parsed.intents.length === testCase.expectedCount;
    const passed = actualKind === testCase.expected && countMatches;

    return {
      ...testCase,
      actual: `${actualKind}; intents=${parsed.intents.length}`,
      passed
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const passed =
      testCase.expected === "error" &&
      (!testCase.expectedError || message.includes(testCase.expectedError));

    return {
      ...testCase,
      actual: `error; ${message}`,
      passed
    };
  }
}

async function main() {
  const results = await Promise.all(cases.map(runCase));
  const passedCount = results.filter((result) => result.passed).length;

  console.log(`AI Agent boundary QA: ${passedCount}/${results.length} cases passed`);
  console.log("");
  console.log("| ID | Category | Expected | Actual | Result |");
  console.log("| --- | --- | --- | --- | --- |");
  for (const result of results) {
    console.log(
      `| ${result.id} | ${result.category} | ${result.expected} | ${result.actual.replaceAll("|", "\\|")} | ${
        result.passed ? "PASS" : "FAIL"
      } |`
    );
  }

  if (passedCount !== results.length) {
    process.exitCode = 1;
  }
}

void main();
