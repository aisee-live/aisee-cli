# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed
- `channels list` renames `extension_session` to `browser_session`, pairing it with the existing `browser_signed_in_as`. The four states (`matched`, `not_matched`, `stale`, `unknown`) are unchanged — the backend's own two-valued `activeSessionClient` cannot express `stale` or `unknown`, and reporting it raw would show a never-probed channel as if the browser were signed out.
- `channels list` drops `send_path`. It was org-level config keyed by platform, so every channel on a platform repeated the same value; the presence of `browser_session` now marks a browser-published channel. Per-post send paths are unaffected and still reported by `post list`.
- The root `aisee --help` now names `--format` and `--fields` directly instead of hiding them behind `--all-options`.

### Fixed
- `--all-options` now actually reveals the built-in options (`--format`, `--fields`, `--dry-run`, ...) in command help; the flag was accepted but never forwarded to the CLI builder.
- `channels list` in table format no longer drops the `browser_session` column when a server-published channel happens to sort first — the plain-text table sized its columns from the first row alone.
- Top-level `aisee --help` lists the common per-command options, so output formats such as `--format json` are discoverable from the root help.

## [0.7.0] - 2026-09-04

### Added
- New `aisee plan` command group for project planning capabilities.
- Project-scoped posts and analytics filtering for better organization.

### Changed
- De-duplicated render helpers and expanded coverage to reconciliation path.

### Fixed
- Pending count calculation to reflect accurate state.
- Corrected two silent scope widenings that were incorrectly expanding query ranges.
- API alignment with current orchestrator and postiz contracts.
- Partial batch failures now correctly exit with non-zero status across all output formats.

## [0.6.1] - 2026-05-15

### Changed
- Enhanced CLI analysis UI with improved color-coding, layout, and responsive metadata display.

### Fixed
- Updated installation commands to specify @latest tag for npm and bun packages.

## [0.6.0] - 2026-05-14

### Added
- `--client-id` support for the login command for improved credential management.

### Changed
- Simplified `config set` command syntax for better usability.

## [0.5.2] - 2026-05-13

### Added
- Advanced automatic terminal background detection. Now checks `ITERM_PROFILE` and macOS system appearance (`AppleInterfaceStyle`) to accurately pick high-contrast colors.

### Fixed
- TUI rendering visibility on dark backgrounds, specifically for Apple Terminal users. Removed incorrect assumption that Apple Terminal always uses a light background.

## [0.5.1] - 2026-05-13

### Changed
- Backfilled missing changelog history for versions 0.2.0, 0.3.0, 0.4.0, and 0.5.0.

## [0.5.0] - 2026-05-13

### Added
- New `channels.select` command for interactive channel selection.
- "Action Plan" section to verbose `report` output, fetching tasks directly from the API.
- Formatted total scores in analysis section headers for better visibility.
- Documentation for the `--verbose` option in the `report` command.

### Changed
- Simplified channel descriptions in the post input schema and documentation.
- Streamlined build scripts by removing static version definitions.
- Updated `apcore` toolkit dependencies and optimized package import paths.

## [0.4.0] - 2026-05-12

### Added
- TUI (Terminal User Interface) rendering capabilities with Markdown integration for a richer terminal experience.
- New formatting utilities for consistent output across commands.

### Changed
- Improved authentication polling robustness with transient error handling and "slow down" support.
- Refined credential storage flow for better security and reliability.

## [0.3.0] - 2026-05-09

### Added
- Markdown output support for execution results and social media post creation.
- `has_solution` filter for analysis actions.

### Changed
- Normalized product URLs and updated argument naming convention to `snake_case`.
- Upgraded `apcore` toolkit dependencies.

## [0.2.0] - 2026-05-07

### Added
- Remote update capability for action posts with `post_id` and `sn` tracking.
- Optional `channelId` filtering for social media posting and improved channel validation.
- Binary generation support in the build process for cross-platform distribution.
- Debug logging for product configurations and analysis tasks.

### Changed
- Normalized `twitter` platform naming to `x`.
- Enhanced CLI help documentation and error logging formats.
- Reorganized dependencies and updated `apcore-toolkit` to v0.5.1.

### Fixed
- Guarded `updateActionPost` calls to ensure stability when IDs are missing.
- Improved filtering of content tasks based on post existence.

## [0.1.0] - 2026-04-30

### Initial Release

AISee CLI is a powerful command-line interface designed to automate AEO (Answer Engine Optimization) analysis and multi-channel content distribution directly from your terminal.

#### Core Features
- **AEO Analysis**: Scan websites to fetch AI-presence reports, competitor analysis, and strategic recommendations.
- **Social Media Automation**: Create, schedule, and publish posts across platforms like X, LinkedIn, and Reddit.
- **Action Pipeline**: Seamlessly convert optimization tasks into social media post drafts in one command.
- **Device Authorization (RFC 8628)**: Secure browser-based OAuth login flow without entering passwords in the terminal.
- **Structured Output**: Every command supports `--format json|table|csv|yaml|jsonl` and field selection.

#### Distribution & Runtime
- **Hybrid Distribution Model**: 
    - **npm**: Lightweight JavaScript bundle (~2MB) for users with Node.js/Bun environments.
    - **Standalone**: Self-contained native binaries (~60MB) for macOS, Linux, and Windows with zero dependencies.
- **Cross-Platform Support**: Native binaries for `darwin-arm64`, `darwin-x64`, `linux-x64`, `linux-arm64`, and `win32-x64`.
- **Dynamic Configuration**: Global configuration support via `~/.config/aisee/config.yaml` and environment variables.
