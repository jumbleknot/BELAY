---
type: Gotcha
title: .env files — no inline comments on value lines
description: dotenv-style loaders treat everything after = as the literal value, so a trailing comment on a KEY=val line becomes part of the secret; comments go on their own line.
tags: [env, secrets, configuration]
timestamp: 2026-11-22
---

# .env files — no inline comments on value lines

**dotenv-style loaders treat everything after `=` as the value.** So `KEY=val # note` yields the
literal `val # note`. In MovieCollectionManager this surfaced as an identity provider rejecting a
client with `invalid_client`, because the client secret had picked up its trailing comment. Nothing
reported a malformed file. The value was simply wrong.

**Put comments on their own lines**, in `.env` files and in the `*.example` templates they are copied
from:

```dotenv
# The client secret, from the identity provider's client credentials tab
CLIENT_SECRET=
```

## Gotchas

- **The failure shows up far from the cause.** The symptom is an authentication or connection error
  from whatever service uses the value, never a parse error. When a credential that "is correct" is
  rejected, check the line it came from for a trailing comment or trailing whitespace.
- **Templates spread the bug.** An `*.example` file with an inline comment is copied into every
  developer's `.env`. Keep templates comment-on-own-line too.

See [the secrets posture](../invariants/secrets-management.md) for where `.env` files may and may not
live.
