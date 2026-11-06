---
name: npm-release
description: Prepare, inspect, and safely publish any npm package from a fixed, verified tarball. Use for version bumps, npm release checks, pack/publish workflows, E401/E403/E404 troubleshooting, scoped packages, workspaces, and optional MCP Registry publication.
---

# npm-release — generic npm publishing skill

Publish any npm package—scoped/unscoped, CLI/library, standalone/workspace—from a reviewed immutable tarball. Derive all package names, directory paths, versions, registries, dist-tags, access settings and build commands from the **current user's project**. Never hardcode a specific package.

## Rules

1. **Prepare is not publish.** Build/test/pack/inspect/validate/login do not authorize publishing. Ask for explicit approval of the exact name, version, tarball, destination registry, tag and public/restricted access **before a publish action**. Require separate approval for optional MCP Registry publishing. Never infer approval from past releases.
2. **Build once; publish the inspected bytes.** Use `npm publish ./artifact.tgz` with `--ignore-scripts` after successful artifact inspection. Do not silently repack or switch to `npm publish .`. Record the SHA-256 and verify it again before publishing.
3. **Never disclose credentials.** Do not display `.npmrc`, registry tokens, OTP, env credentials, login codes or complete npm debug logs. The user handles npm login, 2FA and interactive OAuth locally.
4. **Protect Git and workspaces.** Read Git status, branch, remote, commit and intended changes. Do not commit, tag, push, delete or force-push without authorization. In monorepos select the correct **package directory**; do not publish the root by accident.
5. **Stop on error.** Do not bypass failing checks, silently bump a version, override permissions or retry publication repeatedly. Published npm package versions cannot be overwritten.
6. **Respect project conventions.** Inspect `package.json` (name/version/private/scripts/files/exports/bin/publishConfig/workspaces) and any lockfile. Follow the project's test/build/release approach instead of assuming fixed scripts. Never assume all packages are MIT, CLI tools, or public.
7. **MCP Registry is optional.** Ordinary npm packages do not need `mcpName` or `server.json`; the additional MCP checks only apply when a user wants to publish an MCP server there.

## A — Prepare (no publication)

1. Identify the target package directory, name, target version, source registry, target registry, dist-tag and access. Review Git state and package metadata. Check whether the exact package version is already published:

```bash
npm view 'PACKAGE_NAME@VERSION' version --registry='REGISTRY_URL'
```

   A not-found response for the exact version is expected. It is **not** proof of publishing authorization. Stop if this version already exists.

2. If the user wants a version bump, use existing project release tooling. For a simple standalone npm package `npm version VERSION --no-git-tag-version --ignore-scripts` can update package + lock metadata. Synchronize CHANGELOG and optional manifests per project convention. For workspaces, operate on the intended workspace only.

3. Restore dependencies according to the lockfile/package manager. For npm with a committed lockfile, default to `npm ci --include=dev`. With no lockfile, choose a project-appropriate install method; do not silently create/replace a lockfile. Read scripts before running them.

4. Run existing checks, stopping on failures. Typical commands when defined:

```bash
npm run typecheck --if-present
npm run build --if-present
npm test --if-present
git diff --check
```

   `--if-present` is a no-op for missing scripts, **not** evidence tests ran. Include project-specific lint, integration and release tests if applicable.

5. Build all release outputs **before packaging**. If the project does not depend on publish lifecycle hooks to generate/modify files, use:

```bash
npm pack --ignore-scripts --json
```

   Read the **actual filename** in JSON output—scoped packages often have different tarball names. `--ignore-scripts` prevents `prepack`/`prepare`; if those scripts are necessary, follow the project's established one-time packaging process, inspect the produced artifact, and do not pack again after approval.

## B — Inspect the immutable tarball (no publication)

Use the included, dependency-free, read-only inspector:

```bash
node /PATH/TO/npm-release/scripts/inspect-tarball.mjs ./PACKAGE.tgz \
  --name '@scope/package' \
  --version 1.2.3 \
  --source-dir ./path/to/package \
  --require dist/index.js
```

Only the tarball argument is required; omit or change flags to fit the actual package. Repeat `--require` for expected runtime files. Use `--source-dir .` for standalone projects. The inspector checks packed package identity/version, `private:true`, referenced `bin`/`main`/`module`/`types`/non-wildcard `exports` files, required files, suspicious `.env`/`.npmrc`, source identity and SHA-256. Missing README/LICENSE and wildcard exports produce warnings rather than invented guarantees.

For MCP Registry metadata, explicitly add `--mcp` to verify packaged `server.json`, `mcpName` and npm package/version links; adding `--source-dir` also checks source vs packed `server.json`.

Review warnings and `tar -tzf ./PACKAGE.tgz` when appropriate. Record the artifact SHA, name, version, Git SHA, tag/access and target registry. If changed, return to preparation and re-review a **new** artifact.

## C — Publish to npm (explicit authorization required)

1. Confirm user approval for **this exact artifact and destination**.
2. Verify registry identity/ownership as supported and the unchanged checksum:

```bash
npm whoami --registry='REGISTRY_URL'
npm owner ls 'PACKAGE_NAME' --registry='REGISTRY_URL'
npm view 'PACKAGE_NAME@VERSION' version --registry='REGISTRY_URL'
shasum -a 256 ./PACKAGE.tgz
```

   New packages may not yet have owners; third-party registries may not support `whoami`/owner listing. Verify the owner controls the intended name or scope. E401 may need user-side `npm login --auth-type=web --registry='REGISTRY_URL'`. Do not collect credentials.

3. Once explicitly approved, publish **only the inspected tarball** with chosen tag and access:

```bash
npm publish ./PACKAGE.tgz \
  --ignore-scripts \
  --registry='REGISTRY_URL' \
  --tag='DIST_TAG'
```

   Add `--access=public` **only when public distribution is intended**, especially for a new scoped package. Add `--access=restricted` only when authorized and supported. Do not overwrite `latest` with a prerelease without explicit intent. Respect `publishConfig` and registry-specific requirements.

4. Verify that the exact version and tag are public/visible on the intended registry:

```bash
npm view 'PACKAGE_NAME@VERSION' name version dist.tarball dist.integrity \
  --registry='REGISTRY_URL'
npm dist-tag ls 'PACKAGE_NAME' --registry='REGISTRY_URL'
```

   If needed, download the published package from its returned tarball URL and verify its packaged metadata. Distinguish CLI success, registry visibility and eventual cache propagation. Report prepared/published states separately.

## D — Optional official MCP Registry (separate approval required)

Only for a qualifying MCP package after the correct npm version has been published **including `mcpName`**. The npm tarball inspector with `--mcp` must pass first.

1. `mcp-publisher validate server.json` (from the package directory); a Go HTTP/2 `EOF` on some machines may be worked around by `GODEBUG=http2client=0 mcp-publisher validate server.json`.
2. `mcp-publisher login github` or another supported identity method (user completes private interactive authorization).
3. Look up the exact server name/version in the official Registry. Do not publish a version already present.
4. **After separate explicit approval**, `mcp-publisher publish` (with HTTP/2 workaround if needed).
5. Verify exact name/version in the Registry. This registers metadata; it is not npm publishing or guaranteed third-party directory indexing.

## Failures and safeguards

- **E401:** not authenticated; verify identity and have user log in locally.
- **E403:** owner/scope/2FA/policy problem; do not bypass.
- **E404 on PUT:** may be permissions, not an unused package name.
- **Exact version exists:** cannot republish or overwrite.
- **Missing runtime files in packed archive:** examine `files`, `.npmignore`, build output and lifecycle hooks; rebuild and re-inspect.
- **MCP ownership failure:** inspect the actual npm-published package's `mcpName`, not merely local source.
- **Invalid tarball:** stop. Do not run `npm publish` just to test.

## Completion contract

Report package identity/version, registry, tag/access, artifact path and SHA-256, Git commit, checks run/skipped, publish status, registry verification and outstanding risks. Never claim a publish occurred without evidence. No implicit Git writes or background operations.
