# Agent Notes

## Tooling
- This repo is Bun-first: use `bun install`, keep `bun.lock` committed, and do not recreate `package-lock.json`.
- The root package is still the CLI package; `packages/*` is only a reserved Bun workspace path for future packages.
- Useful checks are `bun run typecheck`, `bun run build`, and `bun run start -- --help`. There are no test or lint scripts in `package.json`.
- `bun run dev` is `tsc --watch`; do not start it unless a watch process is explicitly requested.
- If testing the linked `cobot` command, verify `command -v cobot`; this workspace is expected to link through Bun at `~/.bun/bin/cobot`, not the old NVM/npm global bin.

## Runtime Shape
- Published CLI entry is `dist/bin/cobot.js`, built from `src/bin/cobot.ts`; the shebang is `node`, so the package still supports the Node runtime declared in `engines`.
- CLI flow is `src/bin/cobot.ts` -> `src/cli/startChat.ts` for interactive Ink UI, or `src/cli/runPrompt.ts` for `--prompt`; both create `Agent` from `src/core/agent.ts`.
- TypeScript uses `moduleResolution: NodeNext`; relative source imports intentionally include `.js` extensions even when importing `.ts` files.
- User config is stored at `~/.cobot/config.json` with priority `config file > COBOT_* env vars > OPENAI_* env vars`.

## Adding Or Changing Tools
- Built-in tool schemas live in `src/tools/schemas/index.ts`; handlers live under `src/tools/`; dispatch is wired manually in `src/tools/registry.ts`.
- When adding a tool, update the schema list, import/register it in `TOOL_REGISTRY`, and add the argument mapping in `executeTool`.
- `docs/Plugins.md` is stale design/proposal material: plugin registration APIs mentioned there are not present in `src/`.

## Style And Files
- Respect `.editorconfig`: tabs by default, LF endings, final newline; YAML uses 2 spaces.
- `dist/` is generated and ignored. Rebuild with `bun run build` instead of editing built files.
- `.npmignore` excludes `bun.lock` from published files, but the repository should still track `bun.lock` for reproducible installs.
