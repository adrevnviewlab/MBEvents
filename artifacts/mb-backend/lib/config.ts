import { z } from "zod";
import { AppError } from "@/lib/errors";

// Read once. Every secret stays optional so the app still boots for local planning work.
// Missing integrations are reported as flags, never as values.

const optionalText = z.string().trim().min(1).optional();

const schema = z.object({
  DATABASE_URL: optionalText,
  POSTGRES_URL: optionalText,
  DATABASE_URL_UNPOOLED: optionalText,
  POSTGRES_URL_NON_POOLING: optionalText,
  MB_ADMIN_EMAIL: z.string().trim().toLowerCase().optional().or(z.literal("")),
  MB_ADMIN_PASSWORD: optionalText,
  MB_PUBLIC_ORIGIN: optionalText,
  RESEND_API_KEY: optionalText,
  MB_FROM_EMAIL: optionalText,
  MB_NOTIFY_EMAIL: optionalText,
  STRIPE_SECRET_KEY: optionalText,
  STRIPE_WEBHOOK_SECRET: optionalText,
  MB_MFA_ENCRYPTION_KEY: optionalText,
  MB_FILE_STORAGE: z.enum(["local", "s3"]).optional(),
  MB_FILE_DIR: optionalText,
  MB_S3_BUCKET: optionalText,
  MB_S3_REGION: optionalText,
  MB_S3_ENDPOINT: optionalText,
  MB_S3_ACCESS_KEY_ID: optionalText,
  MB_S3_SECRET_ACCESS_KEY: optionalText,
  MB_BACKUP_DIR: optionalText,
  MB_SMS_ACCOUNT_SID: optionalText,
  MB_SMS_AUTH_TOKEN: optionalText,
  MB_SMS_FROM: optionalText,
});

export type AppConfig = z.infer<typeof schema>;

// Local `next dev` only. Production and tests keep the real sign-in checks.
export function devAuthOpen(nodeEnv = process.env.NODE_ENV) {
  return nodeEnv === "development";
}

export function assertDatabaseUrl(url: string | undefined, nodeEnv = process.env.NODE_ENV) {
  if (!url) {
    if (nodeEnv === "production") throw new AppError("DATABASE_URL is required.", 500);
    return;
  }
  if (url.startsWith("pglite:")) {
    if (nodeEnv === "production") throw new AppError("Production cannot use a PGlite database.", 500);
    return;
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new AppError("DATABASE_URL must be a Postgres URL.", 500);
  }
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new AppError("DATABASE_URL must be a Postgres URL.", 500);
  }
}

export function readConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = schema.safeParse(source);
  if (!parsed.success) throw new AppError("Server environment is invalid.", 500);
  assertDatabaseUrl(parsed.data.DATABASE_URL || parsed.data.POSTGRES_URL);
  return parsed.data;
}

export function integrationFlags(config: AppConfig = readConfig()) {
  const storage = config.MB_FILE_STORAGE ?? "local";
  const s3Ready = Boolean(config.MB_S3_BUCKET && config.MB_S3_REGION && config.MB_S3_ACCESS_KEY_ID && config.MB_S3_SECRET_ACCESS_KEY);
  return {
    database: Boolean(config.DATABASE_URL || config.POSTGRES_URL),
    email: Boolean(config.RESEND_API_KEY && config.MB_FROM_EMAIL),
    // Provider credentials alone are not enough — MB_SMS_ENABLED must be explicitly true.
    sms: Boolean(
      (process.env.MB_SMS_ENABLED ?? "").trim().toLowerCase() === "true"
      && config.MB_SMS_ACCOUNT_SID
      && config.MB_SMS_AUTH_TOKEN
      && config.MB_SMS_FROM
    ),
    emailSandbox: ["1", "true", "sandbox", "test"].includes((process.env.MB_EMAIL_SANDBOX ?? process.env.MB_EMAIL_MODE ?? "").trim().toLowerCase()),
    payments: Boolean(config.STRIPE_SECRET_KEY?.startsWith("sk_test_")),
    mfa: Boolean(config.MB_MFA_ENCRYPTION_KEY && config.MB_MFA_ENCRYPTION_KEY.length >= 16),
    fileStorage: storage,
    fileStorageReady: storage === "local" || s3Ready,
  };
}
