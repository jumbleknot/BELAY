# Quickstart: validating the dependency bot

Sections §1 and §5 are offline. Section §2 is the maintainer's one-time setup. Sections §3 and §4 are live runs, and
need §2 done. Expected outcomes cite [contracts/](contracts/) and [data-model.md](data-model.md) rather than repeating
them.

## §1 Offline: the policy holds (any machine)

```bash
pnpm nx run scripts:lint      # includes check-renovate-config.mjs --selftest: every rule C1–C11 can fail
pnpm nx run scripts:test      # the guard tests run C1–C11 against the real renovate.json and renovate.yml
node scripts/check-renovate-config.mjs
```

**Expect**: `✅ renovate config: N pins managed, M excluded, K holds justified`, with N + M equal to the site total in
data-model.md's inventory. There must be **0 skipped** tests.

**Negative checks**, one at a time on a scratch branch, each reverted afterwards:
- set `"automerge": true` on any rule: C1 fails;
- change the window to `* 5-6 * * 4`: C2 fails, naming both the window and the cron;
- add `export const FOO_VERSION = '1.2.3';` to a script: C6 fails, naming the file and the line.

## §2 Maintainer setup (one time, in the forge's web UI)

The bot cannot create its own account. Every step here happens in a browser, and **no token ever passes through the dev
container or a chat**.

1. **Create the bot account.** Go to Site Administration → User Accounts → Create User Account:
   - Username: `belay-renovate`.
   - Email: Forgejo needs a **unique** address, so yours cannot be reused. The bot never sends or receives mail.
     There are two ways to get one:
     - a plus alias of your own address (`you+renovate@…`), if your provider delivers those to your inbox;
     - a reserved address that never delivers (`belay-renovate@example.invalid`). An admin-created account needs no
       confirmation email. If the instance's email-domain allowlist refuses it, use the alias instead.
   - Password: a long random one. It is only ever used to sign in once and create the token.
   - It must not be an administrator.

   Then edit the user and tick **Restricted**. A restricted user can see only the repositories it is explicitly added
   to.
2. **Give it write access to BELAY only.** In the BELAY repository, go to Settings → Collaborators, add
   `belay-renovate`, and choose **Write**.
3. **Create its token.** Sign in as `belay-renovate` in a private window. Go to Settings → Applications → Generate New
   Token:
   - Name: `renovate-belay`.
   - Permissions:
     - **user: Read**
     - **organization: Read**
     - **repository: Read and Write**
     - **issue: Read and Write**
     - everything else: No access.

   Copy the token once and sign out. MCM measured that each of these scopes is needed. A missing one shows up later as
   a 403 on that particular call, which the preflight step (§3) catches.
4. **Store it as an Actions secret.** In BELAY, go to Settings → Actions → Secrets → Add Secret. Name it
   `RENOVATE_TOKEN` and paste the token as its value. Note the token's expiry, if you set one, in your calendar.
   Rotating it means repeating steps 3 and 4.
5. **Recommended: a github.com read token.** Renovate looks up GitHub releases (Trivy, uv, PowerShell, Spec Kit,
   cargo-audit, rustup) and action versions. Anonymously that is 60 requests an hour, shared with MovieCollectionManager's
   bot on the same runner.

   On github.com, go to Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate:
   - Repository access: **Public repositories (read-only)**.
   - No permissions.
   - A one-year expiry.

   Store it in BELAY as the Actions secret `RENOVATE_GITHUB_COM_TOKEN`. It must not start with `GITHUB_`: Forgejo
   reserves that prefix.
6. **Turn on branch deletion after merge.** In BELAY, go to Settings → Repository → Pull Requests and tick **Delete pull
   request branch after merge by default**. A surviving bot branch is reused verbatim and opens an empty PR.
7. **Tell the session that the secrets are in.** The session checks only by dispatching the dry run in §3. It never
   reads the secret.

## §3 Dry run (after §2, before the first live run)

```bash
node scripts/forge-pr.mjs dispatch renovate.yml --ref main     # dryRun defaults to true
```

**Expect**:
1. The `renovate/mode` status on main's tip reads `DRY RUN (creates nothing)`.
2. Preflight passes. A failure names the missing secret or the refused call, never the token.
3. The validator passes.
4. The verdict reads `✅ renovate run: done …`, and the commit status `renovate/verdict` on main's tip is `success`
   (`node scripts/ci-status.mjs status --sha <tip>`).
5. In the uploaded log, "Detected Dependencies" lists:
   - `node` under `github-actions`, which confirms research R8;
   - every custom manager's dependency;
   - **no** `belay-devcontainer` lookup.
6. No new branch exists: `git ls-remote origin 'refs/heads/renovate/*'` is unchanged.

## §4 First live run (SC-001, SC-004, SC-005, SC-006)

Wait for Wednesday's 05:00 UTC window, or dispatch with `dryRun=false` and the maintainer's explicit go-ahead.

**Expect**:
- A `Dependency Dashboard` issue exists, labelled `status/bot-managed`.
- `node scripts/backlog.mjs ready` does not list it, and prints the "bot-managed item(s) not listed" line.
- At most `prHourlyLimit` (4) new PRs, in priority order (contract C4).
- Every major update sits under "Pending Approval" on the dashboard.
- Every bot PR runs the full `guardrails` check, and nothing merges it.
- The base-image re-pin, once Docker Hub rebuilds `node:26-bookworm`, also deletes the CVE-2026-99083 allowlist entry
  and the `linux-libc-dev` upgrade layer. Until it does, `sweep/verdict` reports the entry UNMATCHED.

**Record** the following on item #47 (SC-006):
- the PRs opened;
- the dashboard's pending, approval and problem sections;
- anything held, with its reason.

## §5 Version-and-checksum pairs (FR-009), offline and on the PR

```bash
node scripts/refresh-pin-checksum.mjs --selftest
```

**Expect**: it passes, with no network use.

**Negative check**: on a scratch branch, change only `TRIVY_PIN.version`. `guardrails` fails at "Verify version-and-checksum
pairs", naming `trivy` and both digests.

**On a real bot PR** for Trivy, rustup or cargo-audit, the diff moves the version **and** its sha256, and the same step
passes.
