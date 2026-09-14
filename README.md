# ViralFlow AI

Phase 2 multi-account intelligence foundation for a Thailand-focused TikTok affiliate workflow platform.

## Local setup

1. Copy `.env.example` to `.env.local` and add the project URL and publishable key.
2. Run `pnpm install`.
3. Run `pnpm dev`.

To expose the development-only mock seed action, set `ALLOW_DEV_MOCK_SEED=true`
locally. The action is unavailable in production builds and never runs automatically.

Use `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm build` before committing. Never place service-role keys or provider secrets in `NEXT_PUBLIC_` variables.
