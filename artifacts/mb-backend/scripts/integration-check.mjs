// Read-only readiness flags. Does not print secret values or call Stripe/Resend/S3.
import { loadLocalEnv } from "./load-local-env.mjs";

loadLocalEnv();

const storage = (process.env.MB_FILE_STORAGE || "local").trim().toLowerCase();
const s3Ready = Boolean(
  process.env.MB_S3_BUCKET?.trim()
  && process.env.MB_S3_REGION?.trim()
  && process.env.MB_S3_ACCESS_KEY_ID?.trim()
  && process.env.MB_S3_SECRET_ACCESS_KEY?.trim(),
);
const stripe = (process.env.STRIPE_SECRET_KEY || "").trim();
const flags = {
  database: Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL),
  email: Boolean(process.env.RESEND_API_KEY?.trim() && process.env.MB_FROM_EMAIL?.trim()),
  emailSandbox: ["1", "true", "sandbox", "test"].includes((process.env.MB_EMAIL_SANDBOX || process.env.MB_EMAIL_MODE || "").trim().toLowerCase()),
  sms: (process.env.MB_SMS_ENABLED || "").trim().toLowerCase() === "true"
    && Boolean(process.env.MB_SMS_ACCOUNT_SID?.trim() && process.env.MB_SMS_AUTH_TOKEN?.trim() && process.env.MB_SMS_FROM?.trim()),
  paymentsTest: stripe.startsWith("sk_test_"),
  paymentsLiveBlocked: stripe.startsWith("sk_live_"),
  stripeWebhook: Boolean(process.env.STRIPE_WEBHOOK_SECRET?.trim()),
  mfa: Boolean(process.env.MB_MFA_ENCRYPTION_KEY && process.env.MB_MFA_ENCRYPTION_KEY.length >= 16),
  fileStorage: storage === "s3" ? "s3" : "local",
  fileStorageReady: storage !== "s3" || s3Ready,
  publicOrigin: Boolean(process.env.MB_PUBLIC_ORIGIN?.trim()),
  ownerCreds: Boolean(process.env.MB_ADMIN_EMAIL?.trim() && process.env.MB_ADMIN_PASSWORD?.trim()),
};

console.log(JSON.stringify({ ok: true, ...flags }, null, 2));

const blockers = [];
if (!flags.database) blockers.push("DATABASE_URL");
if (!flags.ownerCreds) blockers.push("MB_ADMIN_EMAIL/PASSWORD");
if (flags.paymentsLiveBlocked) blockers.push("sk_live_ is set — refuse until explicitly approved");
if (flags.fileStorage === "s3" && !flags.fileStorageReady) blockers.push("S3 env incomplete");
if (blockers.length) {
  console.error("blockers:", blockers.join(", "));
  process.exit(1);
}
