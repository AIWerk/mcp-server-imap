# @aiwerk/mcp-server-imap

[![npm version](https://img.shields.io/npm/v/@aiwerk/mcp-server-imap)](https://www.npmjs.com/package/@aiwerk/mcp-server-imap)
[![npm downloads](https://img.shields.io/npm/dm/@aiwerk/mcp-server-imap)](https://www.npmjs.com/package/@aiwerk/mcp-server-imap)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**IMAP/SMTP MCP server that works with any email provider.** Set host, user, pass — done.

Unlike Gmail-only or Outlook-only MCP servers, this one speaks standard IMAP/SMTP — so it works with **every** email provider out of the box.

## Why this server?

Most email MCP servers only work with one provider (Gmail, Outlook). This one works with **any** provider that supports IMAP:

- Gmail, Outlook, Yahoo — yes
- Fastmail, ProtonMail Bridge, Zoho — yes
- Self-hosted (Dovecot, Postfix, hMailServer) — yes
- Corporate/hosted (Hostpoint, Infomaniak, OVH) — yes

One server, every mailbox.

## Highlights

- **Universal** — standard IMAP/SMTP, works everywhere
- **Simple setup** — just `IMAP_HOST`, `IMAP_USER`, `IMAP_PASS` and you're connected
- **Safety first** — email sending is **disabled by default** (`SMTP_SEND_ENABLED=false`). Your AI agent can read emails but can't send anything until you explicitly opt in
- **Lazy credentials** — the server starts and exposes its tool list without requiring credentials. Auth is only needed when a tool is actually called
- **Real MIME parsing** — handles multipart, HTML/text, attachments, reply threading

## AIWerk hosted service — `email_send` and `email_reply` are local-only

If you use this server through the AIWerk hosted service at [aiwerkmcp.com](https://aiwerkmcp.com), the two outgoing-mail tools are not exposed:

- ❌ `email_send`
- ❌ `email_reply`

The other 8 read-side tools (`email_list`, `email_read`, `email_search`, `email_folders`, `email_flag`, `email_move`, `email_delete`, `email_attachment`) work normally on the hosted service.

**Why?** The hosted service shares an IP across all users. If outgoing mail went out from that shared IP, the IP would appear in every recipient's `Received:` headers — one bad actor could damage deliverability for every user. There is no shared-IP architecture where arbitrary user sends works safely.

**How to send mail then?** Run the server locally, where outgoing mail goes from your own IP and your own provider reputation. Three paths:

1. **Ad-hoc one-email CLI** — see the next section. Zero config, one-shot.
2. **Direct stdio MCP server** in your client (Cursor, Claude Desktop, OpenClaw) — point your client config at `npx -y @aiwerk/mcp-server-imap` with your `IMAP_*` and `SMTP_*` env vars including `SMTP_SEND_ENABLED=true`.
3. **Local `@aiwerk/mcp-bridge`** — `npx -y @aiwerk/mcp-bridge install imap-email --catalog aiwerkmcp.com`, then point your client at the local bridge endpoint.

In all three cases the mail goes from your home / office IP, not from the hosted service.

## Ad-hoc one-email CLI

> **Note:** On the AIWerk hosted service, the `email_send` and `email_reply` MCP tools are not exposed (the service shares an IP across all users, so allowing arbitrary sends would risk every user's deliverability). Use any of the three paths below to send email locally.

Need to send a single email from the command line — for example, to deliver a draft your AI agent composed? Use `aiwerk-send-email`:

```bash
SMTP_HOST=smtp.gmail.com \
SMTP_PORT=587 \
SMTP_USER=me@gmail.com \
SMTP_PASS='app-password' \
SMTP_FROM='Me <me@gmail.com>' \
npx -y @aiwerk/mcp-server-imap aiwerk-send-email \
  --to "alice@example.com" \
  --subject "Re: invoice" \
  --body "Got it, will pay Monday."
```

On success, exits 0 and prints JSON: `{"ok":true,"messageId":"...","envelope":{...}}`

On failure, exits 1 with the error on stderr. Credentials are never printed.

### All CLI arguments

| Argument | Required | Description |
|---|---|---|
| `--to` | Yes | Recipient(s), comma-separated |
| `--subject` | Yes | Subject line |
| `--body` | One of body/html | Plain-text body |
| `--html` | One of body/html | HTML body (both → multipart) |
| `--in-reply-to` | No | `Message-ID` of original message (thread preservation) |
| `--references` | No | Space-separated reference IDs |
| `--cc` | No | CC recipients, comma-separated |
| `--bcc` | No | BCC recipients, comma-separated |

### CLI environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `SMTP_HOST` | Yes | — | SMTP server hostname |
| `SMTP_PORT` | Yes | — | `587` for STARTTLS, `465` for implicit TLS |
| `SMTP_USER` | Yes | — | SMTP username / email address |
| `SMTP_PASS` | Yes | — | Password or app-specific password |
| `SMTP_FROM` | Yes | — | Sender address (`Name <email>` or plain email) |
| `SMTP_TLS` | No | `false` | `true` for implicit TLS (port 465); `false` for STARTTLS (port 587) |

---

## Install

Three ways to get email tools — pick the one that fits.

**1. Quick (single email)** — `aiwerk-send-email` CLI above: no MCP client needed, one command sends one email.

**2. Direct stdio MCP server** — all 10 email tools exposed to your AI agent:

```bash
npx -y @aiwerk/mcp-server-imap
```

**3. Local bridge with catalog UX** — install via the AIWerk catalog for a guided setup:

```bash
npx -y @aiwerk/mcp-bridge install imap-email --catalog bridge.aiwerk.ch
```

### Option 1 — Hosted (zero setup)

No local runtime, no env vars on your machine — credentials are AES-256-GCM encrypted server-side via HashiCorp Vault.

1. Sign up at **[aiwerkmcp.com](https://aiwerkmcp.com)**.
2. Install **IMAP Email** from the catalog and paste your IMAP/SMTP credentials.
3. Point your MCP client (Claude.ai, Cursor, Hermes, …) at your hosted endpoint:
   ```
   https://bridge.aiwerk.ch/u/<your-user-id>/mcp
   ```
   with your Bearer token.

All 10 tools appear immediately. Install other AIWerk recipes from the same bridge.

### Option 2 — Self-hosted (npx)

Run directly — you manage the credentials:

```bash
IMAP_HOST="imap.example.com" \
IMAP_USER="user@example.com" \
IMAP_PASS="app-password" \
SMTP_HOST="smtp.example.com" \
npx @aiwerk/mcp-server-imap
```

The server starts immediately and responds to `tools/list` even without credentials — they're only required when a tool is actually called (lazy credentials).

## Tools (10)

| Tool | Purpose |
|---|---|
| `email_list` | List emails from a folder |
| `email_read` | Read a single message with full body |
| `email_search` | Search by from/to/subject/date/unread |
| `email_folders` | List all folders with message counts |
| `email_move` | Move messages between folders |
| `email_flag` | Set read/star/flag status |
| `email_delete` | Move messages to Trash |
| `email_send` | Send a new email (requires opt-in) |
| `email_reply` | Reply to a message (requires opt-in) |
| `email_attachment` | List or download attachments |

## Configuration

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "email": {
      "command": "npx",
      "args": ["-y", "@aiwerk/mcp-server-imap"],
      "env": {
        "IMAP_HOST": "imap.example.com",
        "IMAP_USER": "you@example.com",
        "IMAP_PASS": "your-app-password",
        "SMTP_HOST": "smtp.example.com"
      }
    }
  }
}
```

### Cursor / Windsurf / VS Code

Same config format in the respective MCP settings.

### AIWerk hosted service

If you want zero-setup, install via [aiwerkmcp.com](https://aiwerkmcp.com) — see [Option 1](#option-1--hosted-zero-setup) above.

## Environment variables

### IMAP (required)

| Variable | Default | Description |
|---|---|---|
| `IMAP_HOST` | — | IMAP server hostname |
| `IMAP_USER` | — | Email address or username |
| `IMAP_PASS` | — | Password or app-specific password |
| `IMAP_PORT` | `993` | IMAP port |
| `IMAP_TLS` | `true` | Use TLS |
| `IMAP_TIMEOUT` | `30000` | Connection timeout (ms) |

### SMTP (optional, for sending)

| Variable | Default | Description |
|---|---|---|
| `SMTP_HOST` | `${IMAP_HOST}` | SMTP server hostname |
| `SMTP_PORT` | `465` | SMTP port |
| `SMTP_USER` | `${IMAP_USER}` | SMTP username |
| `SMTP_PASS` | `${IMAP_PASS}` | SMTP password |
| `SMTP_TLS` | `true` | Use TLS |
| `SMTP_FROM` | `${IMAP_USER}` | Sender address |
| `SMTP_SEND_ENABLED` | `false` | **Must be `true` to enable sending** |

### Debug

| Variable | Default | Description |
|---|---|---|
| `IMAP_DEBUG` | `false` | Verbose IMAP protocol logging |

## Security

- Email sending is **disabled by default** — set `SMTP_SEND_ENABLED=true` to enable
- Credentials are loaded lazily (only when a tool is called, not at startup)
- No credentials are logged
- Keep credentials in `.env` or a secret manager — never commit them to git

## Supported providers

Tested with: Hostpoint, Gmail (app password), Outlook/Microsoft 365, Yahoo Mail, Fastmail, Dovecot, Postfix.

Works with any standards-compliant IMAP/SMTP server.

## Build from source

```bash
git clone https://github.com/AIWerk/mcp-server-imap
cd mcp-server-imap
npm install
npm run build
node dist/server.js
```

## Contributing

Issues and PRs are welcome! Please open an issue first for larger changes.

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for version history.

## About AIWerk MCP

Part of the **[AIWerk MCP platform](https://aiwerkmcp.com)** — curated, signed MCP recipes served either as npm packages for self-hosting or through our multi-tenant hosted service at [aiwerkmcp.com](https://aiwerkmcp.com).

Other AIWerk MCP servers:

- [@aiwerk/mcp-server-cal](https://github.com/AIWerk/mcp-server-cal) — Cal.com scheduling
- [@aiwerk/mcp-server-wise](https://github.com/AIWerk/mcp-server-wise) — Wise (TransferWise) Personal API, read-only
- [@aiwerk/mcp-server-clawhub](https://github.com/AIWerk/mcp-server-clawhub) — ClawHub skill catalog

Browse the full catalog (20+ recipes including GitHub, Linear, Notion, Stripe, …) at [aiwerkmcp.com](https://aiwerkmcp.com).

## License

MIT — [AIWerk](https://aiwerk.ch)
