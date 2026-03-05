---
name: release
description: "Run the Harnss release workflow — review staged diff, bump version, commit, tag, push, and create a GitHub release. Use when releasing, bumping version, tagging, or creating a release. Argument: major, minor, or patch."
---

# Harnss Release Workflow

Run the full release pipeline. Bump type is passed as `$ARGUMENTS` (major, minor, or patch).

## Step 1: Pre-flight Checks

Run these commands and **read every line of output**:

```bash
git status
git diff --cached --stat
git diff --cached
```

If the diff is too large to read in one shot, read it in chunks (e.g., per-directory or line ranges). **You must read the entire diff before proceeding.**

Review for:
- Test files, scratch files, temp files, debug artifacts (e.g., `test-*.ts`, `scratch.*`, `*.tmp`, `random-*.md`)
- Files that shouldn't be committed (`.env`, credentials, large binaries)

If you find any:
- Unstage or remove them
- Tell the user what you removed

If there are no staged changes but unstaged changes exist, ask the user if they want to stage anything first.
If the working tree is completely clean (nothing to release), tell the user and stop.

## Step 2: Version Bump

### Determine new version

1. Read the current version from `package.json` (the `"version"` field)
2. Get the latest tag: `git tag --sort=-v:refname | head -1`
3. Parse the current version as `MAJOR.MINOR.PATCH`
4. Apply the bump type from `$ARGUMENTS`:
   - `major` → `(MAJOR+1).0.0`
   - `minor` → `MAJOR.(MINOR+1).0`
   - `patch` → `MAJOR.MINOR.(PATCH+1)`
5. If `$ARGUMENTS` is empty or invalid, ask the user which bump type they want

### Check for SDK updates

```bash
npm view @anthropic-ai/claude-agent-sdk version
```

Compare with the version in `package.json` under `dependencies["@anthropic-ai/claude-agent-sdk"]` (strip the `^` prefix for comparison). If a newer version exists, update the dependency version (keep the `^` prefix) and tell the user.

### Apply changes

1. Edit `package.json` to set the new version number
2. Stage it: `git add package.json`
3. If the SDK was updated, also run:
   ```bash
   pnpm install
   git add package.json pnpm-lock.yaml
   ```

## Step 3: Commit

Choose the commit message based on what's staged:

### Feature/fix changes staged (not just version bump)

```
feat: short summary (2-4 key themes)

- Change description 1
- Change description 2
- ...

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
```

Use `fix:` instead of `feat:` if all changes are bug fixes.

### Only version bump staged

```
chore: bump version to X.Y.Z

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
```

If the SDK was also updated:

```
chore: bump version to X.Y.Z and update claude-agent-sdk to A.B.C

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
```

### Always use a HEREDOC

```bash
git commit -m "$(cat <<'EOF'
<message here>

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

## Step 4: Tag & Push

```bash
git tag vX.Y.Z HEAD
git push origin master && git push origin vX.Y.Z
```

If push fails, report the error and stop.

## Step 5: GitHub Release

### Gather context

Get the previous release tag:

```bash
git tag --sort=-v:refname | head -2 | tail -1
```

Read the full diff and commit log since the previous release:

```bash
git log v{prev}...HEAD --oneline
git diff v{prev}...HEAD --stat
git diff v{prev}...HEAD
```

Read ALL of this output. For the full diff, read it in chunks if needed — every line matters for writing accurate release notes.

### Write release notes

Load the template from [references/release-notes-template.md](references/release-notes-template.md) and follow its format exactly.

### Create the release

```bash
gh release create vX.Y.Z --title "vX.Y.Z — Short Descriptive Phrase" --notes "$(cat <<'EOF'
<release notes>
EOF
)"
```

The title uses an em dash (`—`), not a hyphen.

Output the release URL when done so the user can verify.

## Important Notes

- **Never skip reading the full diff** in Step 1. Every line matters.
- The `Co-Authored-By` trailer is **mandatory** on every commit.
- Repo: `https://github.com/OpenSource03/harnss`
- Main branch: `master`
- Changelog URL format: `https://github.com/OpenSource03/harnss/compare/v{prev}...v{current}`
- Package manager: `pnpm` (never use npm or yarn for installs)
