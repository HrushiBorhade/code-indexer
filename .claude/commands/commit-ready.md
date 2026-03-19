Run all CI checks locally to verify the code is ready to commit. Run these commands sequentially and report results:

1. Run `npm run format:check` — verify Prettier formatting
2. Run `npm run lint` — verify ESLint passes
3. Run `npm run typecheck` — verify TypeScript types
4. Run `npm test` — verify all tests pass
5. Run `npm run build` — verify compilation works

If ALL checks pass: Tell me the code is commit-ready and suggest the git add + commit commands with an appropriate commit message based on what changed (check git diff and git status).

If ANY check fails:

- Show exactly what failed
- Run the auto-fix if available (`npm run format` for prettier, `npm run lint:fix` for eslint)
- Re-run the failed check to confirm it's fixed
- If it can't be auto-fixed, show me what I need to fix manually
