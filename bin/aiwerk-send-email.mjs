#!/usr/bin/env node
/**
 * Send a single email via SMTP and exit.
 * Not an MCP server — no stdio JSON-RPC.
 * Usage: see README.md → "Ad-hoc one-email CLI"
 */
import nodemailer from 'nodemailer';

// ---------------------------------------------------------------------------
// Arg parsing (no external deps)
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      result[key] = next;
      i++;
    } else {
      result[key] = true;
    }
  }
  return result;
}

const args = parseArgs(process.argv.slice(2));

// ---------------------------------------------------------------------------
// Validate required CLI args
// ---------------------------------------------------------------------------

const missingArgs = [];
if (!args.to) missingArgs.push('--to');
if (!args.subject) missingArgs.push('--subject');
if (!args.body && !args.html) missingArgs.push('--body or --html (at least one required)');

if (missingArgs.length > 0) {
  process.stderr.write(`Missing required arguments: ${missingArgs.join(', ')}\n`);
  process.exit(2);
}

// ---------------------------------------------------------------------------
// Validate required env vars
// ---------------------------------------------------------------------------

const REQUIRED_ENV = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM'];
const missingEnv = REQUIRED_ENV.filter((k) => !process.env[k]);

if (missingEnv.length > 0) {
  process.stderr.write(`Missing required environment variables: ${missingEnv.join(', ')}\n`);
  process.exit(2);
}

const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM, SMTP_TLS, SMTP_TIMEOUT_MS } = process.env;

const port = Number(SMTP_PORT);
if (!Number.isFinite(port) || port < 1 || port > 65535) {
  process.stderr.write(`SMTP_PORT must be a valid port number (1-65535), got: ${SMTP_PORT}\n`);
  process.exit(2);
}

// SMTP_TLS default false (STARTTLS/587 is the recommended path)
const secure = ['1', 'true', 'yes', 'on'].includes((SMTP_TLS ?? '').toLowerCase());
const timeoutMs = Number(SMTP_TIMEOUT_MS ?? 30000);

// ---------------------------------------------------------------------------
// Build transporter
// ---------------------------------------------------------------------------

const transporter = nodemailer.createTransport({
  host: SMTP_HOST,
  port,
  secure,
  auth: { user: SMTP_USER, pass: SMTP_PASS },
  // Use timeoutMs for nodemailer's internal timeouts too when running short
  connectionTimeout: timeoutMs < 15000 ? timeoutMs : 15000,
  greetingTimeout: timeoutMs < 15000 ? timeoutMs : 15000,
});

// ---------------------------------------------------------------------------
// Build message
// ---------------------------------------------------------------------------

const to = String(args.to).split(',').map((s) => s.trim()).filter(Boolean);
const cc = args.cc ? String(args.cc).split(',').map((s) => s.trim()).filter(Boolean) : undefined;
const bcc = args.bcc ? String(args.bcc).split(',').map((s) => s.trim()).filter(Boolean) : undefined;

const bodyFields =
  args.body && args.html
    ? { text: String(args.body), html: String(args.html) }
    : args.html
      ? { html: String(args.html) }
      : { text: String(args.body) };

const message = {
  from: SMTP_FROM,
  to,
  subject: String(args.subject),
  ...bodyFields,
  ...(cc ? { cc } : {}),
  ...(bcc ? { bcc } : {}),
  ...(args['in-reply-to'] ? { inReplyTo: String(args['in-reply-to']) } : {}),
  ...(args.references ? { references: String(args.references) } : {}),
};

// ---------------------------------------------------------------------------
// Send with global timeout
// ---------------------------------------------------------------------------

const timeoutPromise = new Promise((_, reject) =>
  setTimeout(() => reject(new Error(`Connection timed out after ${timeoutMs}ms`)), timeoutMs),
);

try {
  const info = await Promise.race([transporter.sendMail(message), timeoutPromise]);

  process.stdout.write(
    JSON.stringify({ ok: true, messageId: info.messageId, envelope: info.envelope }) + '\n',
  );
  process.exit(0);
} catch (err) {
  const raw = err instanceof Error ? err.message : String(err);
  // Never leak SMTP_PASS to stderr output
  const safe = raw.replaceAll(SMTP_PASS, '[REDACTED]');
  process.stderr.write(`Send failed: ${safe}\n`);
  process.exit(1);
} finally {
  transporter.close();
}
