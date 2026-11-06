# Daily Skills

A small collection of practical, open-source AI agent skills.

## npm-release — Publish npm packages with confidence

**Build once → inspect the actual tarball → publish exactly those bytes.**

This reusable skill helps AI agents and developers prepare, verify, and release **any npm package**, including scoped packages, CLI tools, libraries, and packages inside a monorepo. It is not specific to Starmux.

**Key capabilities:** existing build/test workflows; dry-run-free local tarball inspection; package/version and runtime entry verification; SHA-256 provenance; npm login/ownership troubleshooting; explicit approval before publication; registry and dist-tag verification. MCP Registry support is **optional** and applies only to eligible MCP packages.

### Install

Requires Node.js and the system `tar` executable. The skill itself has **no npm dependencies**.

**From a clone:**

```bash
git clone https://github.com/cookyecat/Daily-Skills.git
mkdir -p ~/.agents/skills
cp -R Daily-Skills/skills/npm-release ~/.agents/skills/npm-release
```

**Or install the release ZIP** from the repository root:

```bash
mkdir -p ~/.agents/skills
unzip npm-release-skill.zip -d ~/.agents/skills
```

The `~/.agents/skills/` location is a commonly used agent skills directory; adapt to your agent's own skills search path.

### Ask your agent

> Use the npm-release skill to prepare version 1.2.3 of my package. Build, test and inspect the tarball, but do not publish yet.

Once reviewed, you can explicitly authorize the exact tarball and registry for publishing.

### Standalone artifact inspection

This step does not need an AI agent, npm credentials, or network access:

```bash
node skills/npm-release/scripts/inspect-tarball.mjs ./my-package-1.2.3.tgz \
  --name my-package \
  --version 1.2.3 \
  --source-dir /path/to/my-package \
  --require dist/index.js
```

For a scoped package, pass the scoped package name (such as `@example/my-package`). The artifact filename can differ; use the **actual** filename returned by `npm pack --ignore-scripts --json`.

Available options:

| Option | Meaning |
| --- | --- |
| `--name NAME` | Expected npm package name (scoped/unscoped) |
| `--version VER` | Expected semver |
| `--source-dir DIR` | Verify packaged identity against the source package |
| `--require FILE` | Require a package-relative file; repeat for multiple files |
| `--mcp` | Optionally verify packaged `mcpName` and `server.json` |
| `--help` | Print usage |

The inspector checks the **artifact itself**, not just local `package.json`. It also checks the packaged `bin`, `main`, `module`, `types` and concrete `exports` paths. It reports wildcard export targets and absent README/LICENSE as warnings, rather than claiming they were verified.

### Repository contents

```text
Daily-Skills/
├── README.md
├── LICENSE
├── skills/
│   └── npm-release/
│       ├── SKILL.md
│       └── scripts/
│           └── inspect-tarball.mjs
├── tests/
│   └── inspect-tarball.test.mjs
└── npm-release-skill.zip
```

### Run tests

```bash
node --test tests/*.test.mjs
```

Tests create temporary synthetic npm packages locally, produce tarballs, and exercise successful/failed validation. They do not publish anything.

### Safety boundaries

- Publishing is **never** inferred from building, packing, logging in or previous releases.
- Permission is required separately for npm publishing and (if used) MCP Registry publication.
- Published npm versions are immutable; permission failures must be diagnosed rather than circumvented.
- No credentials are collected or printed.
- The inspector is an artifact-integrity guard, **not** a full supply-chain security audit.

The Skill follows npm's documented package packing and publishing behavior. See [npm pack](https://docs.npmjs.com/cli/commands/npm-pack/), [npm publish](https://docs.npmjs.com/cli/commands/npm-publish/) and [npm package.json](https://docs.npmjs.com/cli/configuring-npm/package-json).

## License

MIT — see [LICENSE](LICENSE).
