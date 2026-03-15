# @aiwerk/mcp-server-imap

IMAP/SMTP MCP server for any email provider.  
It exposes tools to list/read/search/manage emails over IMAP and send emails over SMTP.

## Features

- Works with any provider that supports IMAP + SMTP
- MCP stdio server (easy to run via `npx` or bridge/desktop configs)
- Email tools:
  - `email_list`
  - `email_read`
  - `email_search`
  - `email_folders`
  - `email_move`
  - `email_flag`
  - `email_delete`
  - `email_send`

## Quick start

```bash
# 1) Run directly with npx
IMAP_HOST="imap.example.com" \
IMAP_USER="user@example.com" \
IMAP_PASS="app-password" \
SMTP_HOST="smtp.example.com" \
npx @aiwerk/mcp-server-imap
```

### Required IMAP env vars

- `IMAP_HOST`
- `IMAP_USER`
- `IMAP_PASS`

### Build from source

```bash
git clone <local-or-private-source>
cd mcp-server-imap
npm install
npm run build
node dist/server.js
```

## Supported providers

- Hostpoint
- Gmail (IMAP enabled + app password / OAuth proxy)
- Outlook / Microsoft 365
- Yahoo Mail
- Any standards-compliant IMAP/SMTP server

## Tool reference

| Tool | Purpose | Key params | Returns |
|---|---|---|---|
| `email_list` | List emails from folder | `folder?`, `limit?`, `unreadOnly?` | `[{ uid, from, to, subject, date, flags, snippet }]` |
| `email_read` | Read one message | `uid`, `folder?`, `format?` | `{ uid, from, to, cc, subject, date, body, attachments[] }` |
| `email_search` | Search mailbox | `query?`, `from?`, `to?`, `subject?`, `since?`, `before?`, `unread?`, `folder?` | Same as `email_list` |
| `email_folders` | List folders + counts | none | `[{ name, path, delimiter, specialUse?, messageCount, unseenCount }]` |
| `email_move` | Move messages | `uids`, `from?`, `to` | `{ moved }` |
| `email_flag` | Read/star flags | `uids`, `action`, `folder?` | `{ flagged }` |
| `email_delete` | Move to Trash | `uids`, `folder?` | `{ deleted }` |
| `email_send` | Send email | `to`, `subject`, `body`, `html?`, `cc?`, `bcc?`, `replyTo?`, `inReplyTo?` | `{ messageId, accepted[] }` |

## Configuration reference

All values are loaded from environment variables.

### IMAP

- `IMAP_HOST` (required)
- `IMAP_PORT` (default: `993`)
- `IMAP_USER` (required)
- `IMAP_PASS` (required)
- `IMAP_TLS` (default: `true`)
- `IMAP_TIMEOUT` (default: `30000` ms)

### SMTP

- `SMTP_HOST` (default: `${IMAP_HOST}`)
- `SMTP_PORT` (default: `465`)
- `SMTP_USER` (default: `${IMAP_USER}`)
- `SMTP_PASS` (default: `${IMAP_PASS}`)
- `SMTP_TLS` (default: `true`)
- `SMTP_FROM` (default: `${IMAP_USER}`)
- `SMTP_SEND_ENABLED` (default: `false`) - **must be explicitly set to `true` to enable email sending**. This is a safety gate to prevent AI agents from sending emails without explicit opt-in.

If neither `SMTP_HOST` nor `IMAP_HOST` is set, `email_send` returns:

- `SMTP not configured`

## Example: mcp-bridge config

```json
{
  "mcpServers": {
    "imap": {
      "command": "npx",
      "args": ["-y", "@aiwerk/mcp-server-imap"],
      "env": {
        "IMAP_HOST": "${IMAP_HOST}",
        "IMAP_PORT": "${IMAP_PORT}",
        "IMAP_USER": "${IMAP_USER}",
        "IMAP_PASS": "${IMAP_PASS}",
        "IMAP_TLS": "${IMAP_TLS}",
        "IMAP_TIMEOUT": "${IMAP_TIMEOUT}",
        "SMTP_HOST": "${SMTP_HOST}",
        "SMTP_PORT": "${SMTP_PORT}",
        "SMTP_USER": "${SMTP_USER}",
        "SMTP_PASS": "${SMTP_PASS}",
        "SMTP_TLS": "${SMTP_TLS}",
        "SMTP_FROM": "${SMTP_FROM}"
      }
    }
  }
}
```

## Example: Claude Desktop config

```json
{
  "mcpServers": {
    "imap": {
      "command": "npx",
      "args": ["-y", "@aiwerk/mcp-server-imap"],
      "env": {
        "IMAP_HOST": "${IMAP_HOST}",
        "IMAP_USER": "${IMAP_USER}",
        "IMAP_PASS": "${IMAP_PASS}",
        "SMTP_HOST": "${SMTP_HOST}",
        "SMTP_USER": "${SMTP_USER}",
        "SMTP_PASS": "${SMTP_PASS}"
      }
    }
  }
}
```

## Error handling

- Connection failures: `IMAP connection failed: <host>:<port> — check IMAP_HOST, IMAP_USER, IMAP_PASS`
- Authentication failures: `IMAP authentication failed — check credentials`
- Timeout-related failures mention `IMAP_TIMEOUT`

## Security note

- Keep credentials in `.env` or secret manager.
- Never commit credentials to git.
- This server does not log passwords and only uses credentials to establish IMAP/SMTP sessions.
