import { ChatOpenAI } from "@langchain/openai";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { z } from "zod";
import type { Intent } from "../../shared/types.js";
import { AliasMemory, defaultAliasMemory } from "./memory.js";

const ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;

const parsedIntentSchema = z.object({
  intents: z.array(
    z.object({
      to: z.string().min(1),
      amount: z.string().min(1),
      token: z.string().min(1)
    })
  )
});

export interface ParseIntentResult {
  intents: Intent[];
  memory: Record<string, string>;
  parser: "langchain-openai" | "fallback";
}

export class IntentParser {
  constructor(private readonly memory: AliasMemory = defaultAliasMemory) {}

  async parse(text: string): Promise<ParseIntentResult> {
    const learned = this.memory.learnFromText(text);
    const hasTransfer = /\bsend\b/i.test(text);

    if (!hasTransfer) {
      return {
        intents: [],
        memory: { ...this.memory.entries(), ...learned },
        parser: "fallback"
      };
    }

    const useLlm = process.env.USE_LLM_PARSER !== "false" && Boolean(process.env.OPENAI_API_KEY);
    const rawIntents = useLlm ? await this.parseWithLangChain(text) : this.parseWithFallback(text);

    return {
      intents: rawIntents.map((intent) => this.normalizeIntent(intent)),
      memory: this.memory.entries(),
      parser: useLlm ? "langchain-openai" : "fallback"
    };
  }

  private async parseWithLangChain(text: string): Promise<Intent[]> {
    const model = new ChatOpenAI({
      model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
      temperature: 0
    });

    const prompt = ChatPromptTemplate.fromMessages([
      [
        "system",
        [
          "You parse transfer commands into strict JSON.",
          "Return only JSON shaped as {{\"intents\":[{{\"to\":\"alias-or-address\",\"amount\":\"10\",\"token\":\"USDC\"}}]}}",
          "Do not invent addresses. If a recipient is an alias, keep the alias text."
        ].join(" ")
      ],
      ["human", "{input}"]
    ]);

    const response = await prompt.pipe(model).invoke({ input: text });
    const content = Array.isArray(response.content)
      ? response.content.map((part) => (typeof part === "string" ? part : "")).join("")
      : String(response.content);

    const jsonText = this.extractJson(content);
    const parsed = parsedIntentSchema.parse(JSON.parse(jsonText));
    return parsed.intents.map(
      (intent): Intent => ({
        to: intent.to,
        amount: intent.amount,
        token: intent.token
      })
    );
  }

  private parseWithFallback(text: string): Intent[] {
    const decimalMarker = "__DECIMAL_POINT__";
    const normalized = text
      .replace(/(\d)\.(\d)/g, `$1${decimalMarker}$2`)
      .replace(/\band then\b/gi, ".")
      .replace(/\s+/g, " ");
    const parts = normalized
      .split(/[.\n;]+/g)
      .flatMap((segment) => segment.split(/\s+\band\b\s+/i))
      .map((segment) => segment.trim())
      .filter((part) => /\bsend\b/i.test(part));
    const candidates = parts.length > 0 ? parts : [text];

    return candidates.map((candidate) => {
      const restoredCandidate = candidate.replaceAll(decimalMarker, ".");
      const match = restoredCandidate.match(
        /\bsend\s+([0-9]+(?:\.[0-9]+)?)\s+([a-zA-Z][a-zA-Z0-9]*)\s+to\s+(.+?)\.?$/i
      );
      if (!match) {
        throw new Error(`Could not parse transfer intent: ${restoredCandidate}`);
      }

      return {
        amount: match[1],
        token: match[2].toUpperCase(),
        to: match[3].trim().replace(/[.。]$/, "")
      };
    });
  }

  private normalizeIntent(intent: Intent): Intent {
    const resolvedRecipient = this.memory.resolve(intent.to);
    if (!resolvedRecipient || !ADDRESS_PATTERN.test(resolvedRecipient)) {
      throw new Error(`Unknown recipient alias or invalid address: ${intent.to}`);
    }

    return {
      to: resolvedRecipient,
      amount: intent.amount,
      token: intent.token.toUpperCase()
    };
  }

  private extractJson(content: string) {
    const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) {
      return fenced[1].trim();
    }

    const firstBrace = content.indexOf("{");
    const lastBrace = content.lastIndexOf("}");
    if (firstBrace === -1 || lastBrace === -1 || lastBrace < firstBrace) {
      throw new Error(`Model did not return JSON: ${content}`);
    }

    return content.slice(firstBrace, lastBrace + 1);
  }
}

export const defaultIntentParser = new IntentParser();
