---
name: skill-installer
description: Install or remove third-party Axiomics skills from a public git repository. Use when the user says "add this skill <url>", "install skill <url>", or "remove skill <namespace>". The skill runs locally via `axiomics skill add|list|remove`, reviews the fetched content, prompts the user to confirm, and writes accepted skills under ~/.axiomics/installed-skills/.
category: other
license: MIT license
metadata:
    skill-author: InkVell Inc.
---

# Skill Installer

## Overview

Installs URL-supplied third-party skills into the Axiomics CLI. The skill itself is a thin wrapper around the bundled `axiomics skill` bash subcommand. When the user expresses install or uninstall intent, invoke `axiomics skill add|list|remove` through the shell. The CLI handles fetching, local security review, confirmation, and the on-disk write.

## When to Use This Skill

Trigger on user messages like:

- "Add this skill: <url>"
- "Install <url>" / "Install the skill at <url>"
- "Set up skills from <repo>"
- "Remove the X skill" / "Uninstall <namespace>"
- "List my installed skills"

Do NOT use this skill for:

- Generating new skills (different workflow — see `axiomics learn`)
- Installing system packages (use `bash` directly)
- Anything that is not an Axiomics skill source

## How to Use

### Add a skill

```
axiomics skill add <git-url>
```

Accepted URL forms:

- `https://github.com/<owner>/<repo>` — default branch, all skills in `skills/**/SKILL.md`
- `https://github.com/<owner>/<repo>/tree/<ref>` — specific ref/tag
- `gh:<owner>/<repo>` — shorthand
- `gh:<owner>/<repo>@<ref>[/<path>]` — shorthand with ref and optional path scope
- Generic `git+ssh://...` / `https://gitlab.com/...` URLs

What happens when the user runs `add`:

1. CLI clones the repo into a temp dir, pins the commit SHA.
2. Enumerates `skills/<name>/SKILL.md` files.
3. Runs the local rejection and warning rules on every `SKILL.md` and companion script.
4. Renders a confirmation screen showing the manifest, warnings, and the first lines of each `SKILL.md`.
5. On approval, writes the accepted files to `~/.axiomics/installed-skills/<namespace>/skills/<name>/`.

The `<namespace>` is derived from the repo name (last URL segment, lowercased).

### List installed skills

```
axiomics skill list
```

Prints `<namespace>/<name>` with a `⚠` marker for any skill the safety gate warned on.

### Remove a skill

```
axiomics skill remove <namespace>            # whole namespace
axiomics skill remove <namespace>/<name>     # single skill within a namespace
```

Removes the selected on-disk directory.

## Examples

User: "Install the brainstorming skill from a public skills repository."

You: invoke `bash` with `axiomics skill add gh:anthropics/superpowers/skills/brainstorming`. Wait for the spinner + confirm prompt. Relay the manifest to the user. Pass through their `y/N` response.

User: "Uninstall everything in superpowers."

You: invoke `bash` with `axiomics skill remove superpowers`. Report the count of archived skills.

User: "What's installed?"

You: invoke `bash` with `axiomics skill list`. Print the output.

## Safety Notes

The user-facing `axiomics skill add` command rejects dangerous runtime patterns and classifier-directed prompt injection, warns on suspicious content, asks for confirmation, and applies deferred `allowed-tools` sandboxing. Always use the CLI command so the complete local review and installation ledger remain intact.

## Reference

- On-disk layout: `~/.axiomics/installed-skills/<namespace>/skills/<name>/SKILL.md`
- Installation ledger: `~/.axiomics/installed-skills/<namespace>/.axiomics-install.json`
