Here's a clean, high-quality **TypeScript version** of your `CLAUDE.md` (now adapted as `GROK.md` or `CODE_GUIDELINES.md`):

---

# High-Quality Code Specification – Simplicity, Readability, and Maintainability First

## Project Overview
AISee Core Platform is a modular microservices architecture providing authentication and orchestration services.

## Core Principles
- Prioritize **simplicity, readability, and maintainability** above all.
- Avoid premature abstraction, optimization, or over-engineering.
- Code should be understandable in ≤10 seconds; favor straightforward over clever.
- Always follow: Understand → Plan → Implement minimally → Test/Validate → Commit.

## TypeScript Code Quality

### Readability
- Use precise, full-word names (standard abbreviations only when conventional, e.g. `id`, `url`, `config`).
- Functions should be small (ideally ≤50 lines), have a single responsibility, and be verb-named.
- Avoid obscure tricks, deeply nested ternaries, excessive optional chaining, or unnecessary type assertions.
- Break complex logic into small, well-named helper functions or pure utilities.
- Prefer clear, explicit code over "elegant" one-liners.

### Types (Mandatory)
- Full type annotations everywhere (no `any` unless absolutely necessary for external/dynamic data).
- Prefer `interface` for public APIs and object shapes.
- Use `type` for unions, intersections, utilities, and primitives.
- Favor `Readonly<T>`, `ReadonlyArray<T>`, and branded types (`Newtype` pattern) where appropriate.
- Use strict null checks and `unknown` instead of `any` when dealing with unsafe data.

### Design
- Favor functional style + immutable data where possible.
- Composition over inheritance.
- Use interfaces and type aliases to define clear contracts.
- Avoid circular dependencies (use proper module structure and barrel files carefully).
- Prefer dependency injection for configuration, logging, databases, external clients, etc.
- Keep classes minimal — use them only when state + behavior truly belong together.

### Errors & Resources
- Always handle errors explicitly. Never use empty `catch {}` blocks.
- Use custom error classes extending `Error` for domain-specific errors.
- Leverage `try/catch` with meaningful context.
- Use `using` keyword (TypeScript 5.2+) or `finally` for resource cleanup when applicable.
- Validate and sanitize all public inputs and API payloads.

### Logging
- **Backend / Microservices**:
  - Never use `console.log()`, `console.error()`, etc.
  - Always use a structured logger (e.g. Pino, Winston, or a custom Logger interface).
  - Use `logger.info()` for important flows.
  - Use `logger.error()` with context for exceptions.

- **CLI Tools**:
  - Allowed to use `console.log()`, `console.error()`, `console.table()`, etc. for user-facing output.
  - Keep business logic clean — route output through a dedicated CLI output layer.
  - Prefer separating "logging for debugging" from "output for users".

### Testing
- Unit tests in `__tests__/` or `tests/` directory.
- Aim for ≥90% coverage on core business logic.
- Test file naming: `*.test.ts` or `*.spec.ts`.
- Function test names: `should <behavior> when <condition>`.
- Never modify production code without corresponding test updates.

### Formatting & Linting
- After every change, always run:
  - `eslint --fix`
  - `prettier --write`
  - `tsc --noEmit` (or your type checker)
- Zero linting or type errors allowed before committing.

### Security & Performance
- Never hardcode secrets; always use environment variables or secure config management.
- Validate and sanitize all external inputs.
- Avoid unjustified O(n²) or higher complexity in hot paths.
- Profile only when there's a proven performance issue.

## General Guidelines
- English ONLY for comments, JSDoc, logs, error messages, and commit messages.
- Fully understand the surrounding code and architecture before making changes.
- Do not generate unnecessary documentation, examples, stubs, or bloated barrel files (`index.ts`) unless explicitly requested.
- Keep imports clean and organized. Prefer named imports.
