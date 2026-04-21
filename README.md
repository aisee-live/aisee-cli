# AISEE CLI

AISEE CLI is a high-performance command-line interface designed to bridge AI-driven SEO analysis (AISee Orchestrator) and multi-channel content distribution (Postiz). It allows marketers and developers to automate AEO (Answer Engine Optimization) workflows directly from the terminal.

## Features

- **Device Authorization Flow (RFC 8628)**: Secure, browser-based login without terminal password entry.
- **AEO Analysis**: Trigger website scans and fetch detailed reports on AI presence, competitors, and strategy.
- **Social Media Automation**: Create, list, and schedule posts across multiple channels (X, LinkedIn, etc.).
- **Built with apcore**: Leveraging the `apcore` framework for robust module management and configuration.

## Getting Started

### Prerequisites

- [Bun](https://bun.sh) runtime installed.
- Access to AISee API services.

### Installation

```bash
# Clone the repository
git clone <repository-url>
cd aisee-cli

# Install dependencies
bun install

# Build the executable
bun build ./src/index.ts --compile --outfile aisee
```

### Basic Usage

```bash
# Login to your account
./aisee auth login

# Check your profile and credits
./aisee auth whoami

# Scan a website for AI presence
./aisee scan https://example.com

# View analysis report
./aisee report https://example.com
```

## Documentation

Detailed documentation is available in the [docs](./docs) directory:

- [**Technical Specification**](./docs/SPECIFICATION.md): Architecture, authentication flows, and configuration.
- [**Command Reference**](./docs/COMMANDS.md): Detailed guide for all 22 commands and their flags.
- [**Configuration Guide**](./docs/SPECIFICATION.md#5-configuration-schema): Managing `config.yaml` and environment variables.

## Tech Stack

- **Runtime**: Bun
- **Language**: TypeScript
- **Frameworks**: 
  - `apcore-js` (Core SDK)
  - `apcore-cli` (Command generation)
  - `apcore-toolkit` (Utilities)

---

© 2026 AISee Engineering. All rights reserved.
