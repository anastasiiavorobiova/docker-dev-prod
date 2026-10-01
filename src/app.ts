import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import { checkDbConnection } from "./db.js";

export const app = express();

app.use(express.json());

app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    console.log(
      `${req.method} ${req.originalUrl} → ${res.statusCode} (${Date.now() - start}ms)`,
    );
  });
  next();
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok", uptime: process.uptime() });
});

app.get("/health/db", async (_req, res) => {
  try {
    await checkDbConnection();
    res.json({ status: "ok", db: "up" });
  } catch (err) {
    console.error("Database healthcheck failed:", err);
    res.status(503).json({ status: "error", db: "down" });
  }
});

app.use((req, res) => {
  res.status(404).json({ error: "Not Found", path: req.originalUrl });
});

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  res.status(500).json({ error: "Internal Server Error" });
});
