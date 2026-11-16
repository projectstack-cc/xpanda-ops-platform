# xPanda Ops Platform — Roadmap

> Short and current. **BACKLOG.md** is the itemized source for open work; **CHANGELOG.md** is the
> history. This file only says where the platform is heading — don't copy items into it.
> Rewritten in cleanup-01 (2026-11-16); the QC Cleanup track it used to describe is finished.

## Finish line

**Full legacy retirement** (decision 2026-10-08). Every legacy surface is ported to `/v2`, cut
over, and archived. Then the legacy `_worker.js` and the Cloudflare Pages project retire, and
`/v2` is the whole app.

## Migration status

| Status | Modules |
|---|---|
| **Done** | Admin · QC · Reports · Dock Loading · BOL Email · Production |
| **In progress** | Block Calculator (blk-01 shipped; blk-02, blk-03 open) |
| **On hold — floor / stakeholder sign-off** | Load Builder (lbr-11 cutover) · Job Board Classic · Logistics Classic |
| **Not started** | Safety training (the SDS browser stays standalone at xpanda-sds) · Shell, auth & worker (last) |

The strangler pattern holds throughout: build unlinked, test, cut over (repoint links, archive
the legacy page behind a redirect stub), then delete the stubs once logs show no hits.

## After migration

Parked in BACKLOG.md until real floor data exists — not scheduled:

- Customer history page
- Invoice Analytics mileage (needs the ORS key)
- Management digest, plant TV, yield, and lot → job traceability

## Where things live

- **BACKLOG.md** — every open item, grouped by module.
- **CHANGELOG.md** — what shipped, keyed by prompt/task ID.
- **AGENTS.md** — platform rules and current module status.
