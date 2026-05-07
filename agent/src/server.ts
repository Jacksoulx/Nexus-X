import "dotenv/config";
import express from "express";
import { defaultIntentParser } from "./intentParser.js";

export const app = express();

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
