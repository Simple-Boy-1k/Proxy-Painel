# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added
- Full Telegram bot with IP-based authentication
- Key management (generate, search, block, delete)
- IP-based access (no UID registration)
- Auto-detect IP via Telegram WebApp
- Port/VPS manager with screen sessions
- Broadcast with full formatting
- File upload (fileinfo, cache_res, shaders, zip)
- Multi-language support (en, bn)
- Sub-bot support
- Trial key system

### Fixed
- Async VPS operations (no blocking)
- server.py auto-copy on restart
- Port status checks
- Button lag in Telegram
- Path resolution in .env

## [2.0.0] - 2026-08-12

### Added
- Initial release with full proxy management
- MySQL database integration
- PM2 process management

### Changed
- Complete rewrite from v1
- Better error handling
- Improved UI/UX

## [1.0.0] - 2026-07-01

### Added
- Basic Telegram bot functionality
- Simple key management
