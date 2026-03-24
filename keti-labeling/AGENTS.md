# Repository Guidelines

## Project Structure & Module Organization
- `app/` holds route folders (`page.tsx`, `layout.tsx`, `training/`) and typed data helpers in `models/`.
- `components/` contains shared UI primitives; reuse them instead of duplicating Tailwind markup.
- `hooks/` hosts reusable stateful logic; import these only from components and pages.
- `lib/` houses API clients, schema validation, and utilities; keep it free of React code.
- Static assets sit in `public/`, while global styles and tokens live in `app/globals.css` and `styles/`.

## Build, Test, and Development Commands
- `pnpm install` — sync dependencies against the committed lockfile.
- `pnpm dev` — start the Next.js dev server with hot reload at `localhost:3000`.
- `pnpm build` — create an optimized production bundle; run before releases.
- `pnpm lint` — run ESLint with Next + Tailwind rules; fix or explain warnings.
- `pnpm start` — serve the production bundle locally for smoke testing.

## Coding Style & Naming Conventions
- Write TypeScript with explicit types on exports and validate runtime data with `zod`.
- Name components and files in PascalCase (`TrainingMonitor.tsx`), hooks in camelCase with a `use` prefix, and route folders in kebab-case when Next.js requires it.
- Prefer Tailwind utility classes and `class-variance-authority` variants; skip ad-hoc inline styles.
- Indent with two spaces and rely on editor formatting or `pnpm lint --fix` before committing.

## Testing Guidelines
- Use React Testing Library with Jest (`next/jest`); keep specs as `*.test.tsx` beside components or under `__tests__/`.
- Add `jest.config.ts` from `next/jest` and share test factories from `lib/`.
- Run `pnpm exec jest --watch` during development and `pnpm exec jest --coverage` in CI; aim for ≥80% coverage on new modules.
- Include accessibility checks (`toBeInTheDocument`, `toHaveAccessibleName`) and keep snapshots purposeful.

## Commit & Pull Request Guidelines
- Follow the existing imperative, sentence-case commit style (`Update training configuration...`) and keep commits narrowly scoped.
- Confirm `pnpm lint` and `pnpm build` succeed before pushing; log deferments as follow-up issues.
- PRs must list the change summary, linked issue, test evidence, and screenshots or recordings for UI updates.
- Call out new env vars, migrations, or breaking changes, request review from the owning maintainers, and apply labels (`ui`, `training`, `infra`).

## Environment & Configuration
- Keep secrets in `.env.local`; share sanitized defaults in `.env.example`.
- Adjust Workbox caching when adding routes or assets, and document any manual cache-bust steps in the PR.
