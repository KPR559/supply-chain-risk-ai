# Security Policy

## Reporting a Vulnerability

Please report security vulnerabilities by opening a private issue or emailing
the maintainers directly. **Do not** open a public issue for a vulnerability.

Include, where possible:

- the affected version / commit
- a minimal reproduction
- the impact and any suggested fix

## Secrets

This repository ships **no** secrets or credentials in tracked files. Note:

- `.env`, `.env.local` and `.env.*.local` are git-ignored — never commit them.
- The demo API originates are `allow_origins=["*"]`. If you deploy this outside
  a demo, restrict CORS and add authentication to the stateful routes
  (`/predict`, `/what-if`, `/compare-routes`, …).

## Model / ML-specific notes

- Generated datasets and trained artifacts are not part of the repository
  (git-ignored) and should be regenerated per environment.
- No PII is used; all data is synthetic.
