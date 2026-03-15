# Changelog

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
