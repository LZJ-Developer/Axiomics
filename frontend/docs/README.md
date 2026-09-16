# Axiomics docs

The documentation site for Axiomics, the AI workbench for scientific research.

It is a small Vite + React app that renders a folder of MDX pages — no docs framework, no CMS, no server. Pages live in `src/content/axiomics/` as `.mdx` files plus a `docs.json` that drives the sidebar. Routing is hash-based (`#/axiomics/<page>`), so the whole thing is a static single-page app.

## Develop

```bash
bun install                       # from the repo root
bun run --cwd frontend/docs dev   # hot-reloads .mdx edits
```

## Build

```bash
bun run --cwd frontend/docs build      # emits dist/ with assets under /docs/
bun run --cwd frontend/docs typecheck  # tsc --noEmit
```

## Add a page

1. Create `src/content/axiomics/<page>.mdx` with `title` and `description` frontmatter.
2. Add the page to `src/content/axiomics/docs.json` under the right group.
3. Internal links use `/axiomics/<page>`; they resolve to hash routes at build.
