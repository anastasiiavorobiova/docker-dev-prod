import pg from "pg";
import { config } from "./config.js";

export const pool = new pg.Pool({
  ...config.db,
  connectionTimeoutMillis: 5000,
});

pool.on("error", (err) => {
  console.error("Unexpected PostgreSQL pool error:", err.message);
});

export async function checkDbConnection(): Promise<void> {
  await pool.query("SELECT 1");
}
