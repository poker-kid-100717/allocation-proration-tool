# Allocation Proration

[![ci](https://github.com/poker-kid-100717/allocation-proration-tool/actions/workflows/ci.yml/badge.svg)](https://github.com/poker-kid-100717/allocation-proration-tool/actions/workflows/ci.yml)

Splits a limited investment allocation (for example, a startup round that's oversubscribed) across investors in proportion to their historical average investment. No investor ever receives more than they requested.

**Live:** `https://allocation-proration.<your-subdomain>.workers.dev` _(filled in after the first deploy)_

## The problem

When more money is requested than is available, the allocation is prorated:

1. If total requests fit within the allocation, everyone gets exactly what they asked for.
2. Otherwise, each investor's share is `allocation × (their average ÷ sum of averages)`.
3. An investor whose share exceeds their request is **capped** at the request. The surplus goes back into the pool and is re-split among the remaining investors by the same rule, repeating until nobody exceeds their request.

Step 3 is where naive implementations go wrong. Clamping each share with `min(share, requested)` leaves money unallocated whenever someone gets capped.

| Allocation | Investor (requested / average)          | Result                              |
| ---------- | --------------------------------------- | ----------------------------------- |
| 100        | A (100 / 100), B (25 / 25)              | A 80, B 20                          |
| 200        | A (100 / 100), B (25 / 25)              | A 100, B 25                         |
| 100        | A (100 / 95), B (2 / 1), C (1 / 4)      | A 97.96875, B 1.03125, C 1          |
| 100        | A (100 / 95), B (1 / 1), C (1 / 4)      | A 98, B 1, C 1                      |

The algorithm lives in [`src/lib/prorate.ts`](src/lib/prorate.ts) as a pure, dependency-free function. The Worker API and the tests both import it from there.

## Architecture

```
Browser ──► Cloudflare Worker (single origin)
              ├── /api/*   → worker/index.ts  (validation + prorate())
              └── /*       → static assets (Vite-built React SPA)
```

- **Frontend:** React 19 + TypeScript, built with Vite. No UI framework; plain CSS with light/dark themes and a responsive layout.
- **API:** A Cloudflare Worker that serves `POST /api/prorate` and `GET /api/health`. Input is validated (finite, non-negative numbers; unique, non-empty names), and invalid input returns a `400` with a message.
- **Hosting:** [Workers Static Assets](https://developers.cloudflare.com/workers/static-assets/). One `wrangler deploy` ships the UI and the API together. `/api/*` runs the Worker first; every other path is served from the edge cache with SPA fallback.
- **CI/CD:** GitHub Actions runs the typecheck, the tests, and the build on every push and PR. Pushes to `main` deploy to Cloudflare and then smoke-test the live URL.

### API

```http
POST /api/prorate
Content-Type: application/json

{
  "allocation_amount": 100,
  "investor_amounts": [
    { "name": "Investor A", "requested_amount": 100, "average_amount": 100 },
    { "name": "Investor B", "requested_amount": 25,  "average_amount": 25 }
  ]
}
```

```json
{ "Investor A": 80, "Investor B": 20 }
```

## Running locally

Requires Node 22+.

```bash
npm install
npm test              # unit tests for the algorithm and the Worker
npm run dev:worker    # build, then serve UI + API on the Workers runtime at http://localhost:8787
```

For UI work with hot reload, run `npx wrangler dev` in one terminal and `npm run dev` in another. Vite proxies `/api` to the Worker.

## Deploying

Deployment is automatic on push to `main`. It needs two repository secrets:

| Secret                  | Where to get it                                                               |
| ----------------------- | ----------------------------------------------------------------------------- |
| `CLOUDFLARE_API_TOKEN`  | Cloudflare dashboard → My Profile → API Tokens → "Edit Cloudflare Workers" template |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare dashboard → Workers & Pages → Account ID (right sidebar)           |

To deploy by hand, run `npx wrangler login` and then `npm run deploy`.
