import "dotenv/config";
import express from "express";
import { IntentBundler, loadBundlerConfigFromEnv } from "./bundler.js";
import type { Intent } from "../../shared/types.js";

export const app = express();
export const bundler = new IntentBundler(loadBundlerConfigFromEnv());

const defaultAllowedOrigins = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://0.0.0.0:3000"
];

function allowedCorsOrigin(origin: string | undefined) {
  const configuredOrigins = process.env.CORS_ORIGIN?.split(",").map((value) => value.trim()).filter(Boolean);
  const allowedOrigins = configuredOrigins?.length ? configuredOrigins : defaultAllowedOrigins;

  if (!origin) {
    return allowedOrigins[0];
  }

  if (allowedOrigins.includes(origin) || /^http:\/\/192\.168\.\d{1,3}\.\d{1,3}:3000$/.test(origin)) {
    return origin;
  }

  return allowedOrigins[0];
}

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", allowedCorsOrigin(req.headers.origin));
  res.header("Vary", "Origin");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  res.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");

  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }

  next();
});

app.use(express.json());

app.post("/enqueue-intents", async (req, res) => {
  try {
    const intents: Intent[] = Array.isArray(req.body?.intents) ? req.body.intents : [];
    if (intents.length === 0) {
      res.status(400).json({ error: "Missing intents array" });
      return;
    }

    const receipts = await Promise.all(intents.map((intent) => bundler.enqueue(intent)));
    res.json({ receipts });
  } catch (error) {
    res.status(422).json({
      error: error instanceof Error ? error.message : "Failed to enqueue intents"
    });
  }
});

app.get("/queue", (_req, res) => {
  res.json({ pending: bundler.pendingCount() });
});

if (process.env.NODE_ENV !== "test") {
  const port = Number(process.env.PORT ?? 3002);
  app.listen(port, () => {
    console.log(`Bundler listening on http://localhost:${port}`);
  });
}
