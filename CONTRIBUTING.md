# Contributing to ShopOS

Thank you for helping build ShopOS.

## Before opening a change

1. Read `AGENTS.md` and the relevant domain documentation.
2. Keep the change within one clear business outcome.
3. Add an ADR for a durable architectural decision.
4. Discuss changes that alter tenant boundaries, financial history, authorization semantics, or the
   public API before implementing a broad rewrite.

## Development

```bash
pnpm install
pnpm check
pnpm build
```

Database changes require a migration and tests. Never edit an already-released migration; add a new one.
Seed data must remain fictional and deterministic.

## Pull request expectations

- Explain the user or operator outcome.
- Identify authorization and tenancy implications.
- Describe schema and migration impact.
- Include tests for both allowed and denied behavior.
- Update documentation when implemented behavior or terminology changes.
- List known limitations without disguising planned work as complete.

## Security

Do not open a public issue containing an exploitable vulnerability, secrets, or real customer data. A
private security-reporting channel will be published before the first public release.

## Conduct and licensing

A code of conduct, contributor license policy, and OSI-approved project license are still governance
decisions. Contributions should not be solicited broadly until those files exist.
