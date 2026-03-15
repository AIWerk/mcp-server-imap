# Changelog

## [1.0.0] - 2026-03-15

### Added
- Initial release
- 8 MCP tools: email_list, email_read, email_search, email_folders, email_move, email_flag, email_delete, email_send
- IMAP client with lazy connection, auto-reconnect, trash detection
- SMTP client with IMAP credential fallback
- **SMTP_SEND_ENABLED** safety gate - email sending disabled by default, requires explicit opt-in
- stdio transport via @modelcontextprotocol/sdk
- 12 tests
