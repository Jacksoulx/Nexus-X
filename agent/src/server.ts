import "dotenv/config";
import express from "express";
import { defaultIntentParser } from "./intentParser.js";

export const app = express();

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

app.post("/parse-intent", async (req, res) => {
  try {
    const input = String(req.body?.input ?? req.body?.text ?? "");
    if (!input.trim()) {
      res.status(400).json({ error: "Missing input" });
      return;
    }

    const parsed = await defaultIntentParser.parse(input);
    res.json(parsed.intents);
  } catch (error) {
    res.status(422).json({
      error: error instanceof Error ? error.message : "Failed to parse intent"
    });
  }
});

if (process.env.NODE_ENV !== "test") {
  const port = Number(process.env.PORT ?? 3001);
  app.listen(port, () => {
    console.log(`Agent listening on http://localhost:${port}`);
  });
}
