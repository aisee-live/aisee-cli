# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
