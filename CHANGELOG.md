# Changelog

## 0.1.2 (2026-08-21)

- Rename tools to `ol_email_list` / `ol_email_read` / `ol_email_search` so the plugin coexists with the market `dsh-email` plugin (no tool-name clashes).
- README: document OAuth2 setup for Outlook (Microsoft disabled IMAP Basic Auth for personal accounts in 2024), proxy access for Gmail, and coexistence with the market plugin.

## 0.1.0 (2026-08-21)

- Initial release: `email_list` / `email_read` / `email_search` tools via imapflow.
- Flat or multi-account config; OAuth2 refresh-token exchange; optional HTTP/SOCKS proxy.
