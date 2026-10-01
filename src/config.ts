function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function toPort(name: string, value: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(
      `Environment variable ${name} must be a valid port, got "${value}"`,
    );
  }
  return port;
}

export const config = {
  port: toPort("PORT", required("PORT")),
  db: {
    host: required("DB_HOST"),
    port: toPort("DB_PORT", required("DB_PORT")),
    user: required("DB_USER"),
    password: required("DB_PASSWORD"),
    database: required("DB_NAME"),
  },
} as const;
