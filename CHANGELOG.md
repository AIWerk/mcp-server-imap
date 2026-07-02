# Changelog

## [1.2.2] - 2026-07-02

### Security
- **nodemailer `^7.0.5` → `^9.0.3`** — closes six upstream advisories, including SMTP command injection via `envelope.size` (GHSA-c7w3-x93f-qmm8), CRLF injection via transport name (GHSA-vvjj-xcjg-gr5g), CRLF injection in `List-*` header comments (GHSA-268h-hp4c-crq3), `jsonTransport` file/URL access bypass (GHSA-wqvq-jvpq-h66f), improper TLS validation in OAuth2 token fetch (GHSA-r7g4-qg5f-qqm2), and `raw` option file-read/SSRF bypass (GHSA-p6gq-j5cr-w38f). No API changes in our usage surface (`createTransport`/`sendMail`).
- `@modelcontextprotocol/sdk` `1.27.1` → `1.29.0` and refreshed transitive lockfile resolutions (hono 4.12.27, fast-uri, path-to-regexp, qs, ip-address) — `npm audit`: 0 vulnerabilities.
- `@types/nodemailer` `^7.0.2` → `^8.0.1` (dev).

## [1.2.1] - 2026-06-22

### Changed
- Published to the official MCP Registry as `io.github.AIWerk/mcp-server-imap` (`mcpName` field added to `package.json`). No functional changes.

## [1.2.0] - 2026-05-12

### Added
- **`aiwerk-send-email` CLI** (`bin/aiwerk-send-email.mjs`) — send a single email via SMTP and exit. Not an MCP server; designed for running locally after an AI agent drafts a message on the AIWerk hosted bridge (where `email_send`/`email_reply` MCP tools are disabled for SMTP reputation protection).
  - Args: `--to`, `--subject`, `--body`, `--html`, `--in-reply-to`, `--references`, `--cc`, `--bcc`
  - Env: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `SMTP_TLS`
  - Exit 0 + JSON `{ok,messageId,envelope}` on success; exit 1 + stderr on SMTP error; exit 2 + stderr on missing args/env
  - 30-second global timeout; credentials never written to stderr
- New `bin` entry in `package.json`: `aiwerk-send-email → ./bin/aiwerk-send-email.mjs`
- New `bin` entry: `aiwerk-mcp-server-imap` alias for the MCP server (consistent with other `@aiwerk/mcp-server-*` naming)
- 10 new tests covering: missing args, missing env, successful send, auth fail, connection timeout, multipart body, `In-Reply-To` header, credential leak guard

### Docs
- README: New "Ad-hoc one-email CLI" section (before Install) with usage, all CLI args, and env vars table
- README: Install section restructured as 3-tier: Quick CLI → Direct stdio MCP server → Local bridge with catalog UX

## [1.1.10] - 2026-04-21

### Docs
- README: Split install into Hosted (aiwerkmcp.com) and Self-hosted (npx) options. The hosted option lands on `bridge.aiwerk.ch/u/<user-id>/mcp` with zero local setup — credentials AES-256-GCM encrypted via Vault.
- README: Replaced the stale `catalog.aiwerk.ch` link (sunsetted 2026-04-09) and the `mcp-bridge install imap-email` CLI example (now covered by the hosted flow).
- README: New "About AIWerk MCP" footer cross-linking sibling servers.

### Package metadata
- Added `homepage`, `repository`, and `bugs` fields — surfaces on npmjs.com and external catalogs.

## [1.1.9] - 2026-04-20

### Fixed
- **CLI entry fix** — `isCliEntry` now compares realpath of `import.meta.url` against realpath of `process.argv[1]`. The old `pathToFileURL(argv[1]).href === import.meta.url` check returned false under npm's bin-shim indirection, so `npx @aiwerk/mcp-server-imap` silently exited (code 0, no stdout/stderr) without running `main()`. Discovered via bridge spawn audit — same bug pattern as wise@0.1.0, clawhub@0.1.0, and cal@1.0.1.

## [1.1.8] - 2026-03-20

### Fixed (Axel review — 8 findings, 7.8→9.0)
- **🔴 Dynamic version:** MCP server version now read from package.json (was hardcoded `1.1.0`)
- **🟡 Graceful shutdown:** SIGTERM/SIGINT handlers call `close()` for clean IMAP/SMTP disconnect
- **🟡 Search snippet fallback:** `searchEmails` now uses two-step snippet extraction (bodyParts → source parse), matching `listEmails` behavior
- **🟡 Trash folder cache:** `detectTrashFolder()` result cached — no more repeated IMAP LIST on every delete
- **🟡 True LRU cache:** Parsed email cache now uses delete+set on hit for correct eviction order
- **🟢 Attachment base64:** Only converted on actual fetch, not when listing metadata
- **🟢 SMTP timeouts:** Added `connectionTimeout` and `greetingTimeout` (15s each)
- **🟢 Reply sender fix:** `email_reply` uses `smtp.getFrom()` instead of direct `process.env.SMTP_FROM`

## [1.1.7] - 2026-03-20

### Changed
- **Lazy credential loading:** IMAP/SMTP config is now read on first tool call instead of at startup. The server starts and responds to `tools/list` without requiring credentials. Enables `toolsHash` computation in the AIWerk recipe signing workflow.

## [1.1.6] - 2026-03-16

### Changed
- README revamp: highlights section, ecosystem links, license section

## [1.1.5] - 2026-03-16

### Changed
- Added license section to README.md

## [1.1.4] - 2026-03-15

### Fixed
- Minor dependency updates

## [1.1.3] - 2026-03-15

### Fixed
- replyAll self-filter: extract bare email from "Name <email>" format in SMTP_FROM/IMAP_USER

## [1.1.2] - 2026-03-15

### Performance
- listEmails: two-step fetch (bodyParts first, source only if snippet empty)
- getAttachment: LRU parsed email cache (max 10) avoids double MIME parse

## [1.1.1] - 2026-03-15

### Fixed
- replyAll: filter self-address from CC to avoid sending to ourselves

## [1.1.0] - 2026-03-15

### Added
- 2 new MCP tools: `email_reply`, `email_attachment` (tool count: 10)
- Reply context support in IMAP client (`getReplyContext`)
- Attachment retrieval API with base64 content output (`getAttachment`)
- SMTP transporter pooling with lazy initialization and `close()`
- Test coverage for new tool schema validation (`email_reply`, `email_attachment`)

### Changed
- MIME parsing now uses `mailparser` (`simpleParser`) for robust multipart handling
- `email_read` now parses body/attachments from MIME source instead of naive body splitting
- `email_list` snippet extraction now falls back to MIME parsing when IMAP text bodyParts are empty
- Server close lifecycle now also closes SMTP client

## [1.0.0] - 2026-03-15

### Added
- Initial release
- 8 MCP tools: email_list, email_read, email_search, email_folders, email_move, email_flag, email_delete, email_send
- IMAP client with lazy connection, auto-reconnect, trash detection
- SMTP client with IMAP credential fallback
- **SMTP_SEND_ENABLED** safety gate - email sending disabled by default, requires explicit opt-in
- stdio transport via @modelcontextprotocol/sdk
- 12 tests
