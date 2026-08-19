# Campus Atlas verified-owner authorization contract

**Status:** Long-term production contract

**Introduced:** Sites deployment 19 / source `42ad0138e2caf2ef455d5a409764f49b2297ab88`

**Scope:** Canonical browser writes on the existing Campus Atlas production origin

This contract is a security and durability boundary. Source reconciliation,
UI renovations, build-identity work, environment revisions, and later Sites
deployments must preserve it. A change to this document, the allowlist fields,
the server matcher, or the session UI is an explicit authorization change and
must be reviewed as such; it may not arrive incidentally inside another slice.

## Authority split

1. **Sites authenticates.** Dispatch-owned Sign in with ChatGPT establishes the
   host session and forwards `oai-authenticated-user-id` plus
   `oai-authenticated-user-email`. Sites owns its HttpOnly session, expiry, and
   `/signout-with-chatgpt` revocation behavior. Atlas does not mint a parallel
   browser session.
2. **Atlas authorizes.** `worker/owner-identity.ts` matches only host-forwarded
   identity against the configured owner allowlist. `worker/index.ts` injects
   the server-only action key into an internal request only after that match.
3. **The server decides.** Every canonical mutation still checks the injected
   bearer authorization. Client state, a hostname, IP address, fingerprint,
   query parameter, local flag, or a claim that a device belongs to Cody can
   never authorize a write.
4. **The UI reports.** `/api/v1/session` is the only authority for the visible
   write state. The interface may say **Canonical writes enabled** only when
   `session.writeAuthorization.authorized` is true.

## Exact owner allowlist and identity namespaces

- `CAMPUS_ATLAS_OWNER_USER_ID` is an exact allowlist for the stable user ID
  forwarded by SIWC for this Site. That identifier is per-user and per-Site.
  A Sites management/account identifier from a different namespace is not an
  interchangeable value and must never silently replace it.
- `CAMPUS_ATLAS_OWNER_EMAIL` is the current exact owner bridge between the
  Sites management identity and SIWC identity namespaces. Atlas normalizes case
  only. An email match is accepted only when Sites also forwards a non-empty
  authenticated user ID. Email alone is denied.
- `CAMPUS_ATLAS_ACTION_KEY` remains server-only. It enables the canonical write
  routes, but it is not a browser credential. It must never enter JavaScript,
  HTML, URLs, browser storage, logs, screenshots, source control, build
  metadata, or API responses.
- The production allowlist values live in Sites environment configuration and
  must be preserved across environment revisions. Build identity values are
  independent and must not replace or clear them.

Changing either allowlist field, accepting a new identity namespace, or
removing the requirement for a host user ID is an authorization migration. It
requires an explicit scoped change, negative tests, and owner verification on
the unchanged production origin.

## Required behavior

| Event | Server result | UI result |
|---|---|---|
| Anonymous visit | Read-only | Offers **Sign in as owner** when owner identity is configured |
| Verified owner signs in | Canonical writes authorized | Shows **Canonical writes enabled** and **verified owner identity** |
| Reload on the same origin | Host session is re-evaluated; owner remains authorized while the Sites session is valid | Same confirmed state; no local key prompt |
| Home / Steward / Inspect navigation | Every API request is independently authorized from host identity | State remains server-confirmed across desktop and mobile shells |
| Normal Sites session expires | Host identity headers disappear; writes fail closed | Returns to read-only and may request ChatGPT sign-in again |
| Owner signs out | Sites revokes the host session; no Atlas credential remains | Returns to read-only |
| Missing or mismatched identity | Write returns `401`; no mutation | Never claims writes are enabled |
| Missing server action key | Write returns `401` even for the owner | Reports writes unavailable/read-only |

A normal ChatGPT sign-in may recur when the Sites session expires. The owner
must never need to find a local action key, use Terminal, place a secret in the
browser, or reconstruct authorization setup.

## Deployment durability gate

Every deployment that touches source reconciliation, hosting, shell/session UI,
environment variables, or build identity must verify all of the following:

1. The production origin is unchanged unless an explicit identity migration is
   approved; SIWC user IDs are Site-scoped.
2. The exact owner allowlist and server action-key entries still exist in Sites
   environment configuration. Their values are never printed.
3. Anonymous and mismatched requests are read-only and canonical mutations
   return `401`.
4. A verified owner session survives reload and navigation on the same origin.
5. Sign-out or session loss immediately restores fail-closed behavior.
6. The browser bundle contains no action key, owner allowlist value, manual-key
   field, or browser-side authorization override.
7. Production health reports the exact committed source identity without
   exposing authorization values.

Automated coverage enforces the server and presentation invariants. A real
owner-session reload remains the final hosted check because its HttpOnly Sites
session must not be extracted or simulated by development tooling.

## Local development

Local preview does not possess Sites-authenticated identity headers. It remains
read-only unless a test harness explicitly supplies trusted header fixtures.
`CAMPUS_ATLAS_LOCAL_AUTO_WRITES`, hostname trust, and device claims are not part
of this contract and must not be enabled in production.
