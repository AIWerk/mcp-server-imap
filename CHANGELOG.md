# Changelog

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
