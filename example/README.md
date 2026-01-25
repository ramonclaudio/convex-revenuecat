# Example App

This directory contains an example Convex backend demonstrating the RevenueCat component.

## Structure

```
example/convex/
├── convex.config.ts   # Registers the component
├── http.ts            # Mounts webhook handler
├── subscriptions.ts   # Example queries/mutations
└── *.test.ts          # Integration tests
```

## Running

From the repo root:

```bash
npm run dev    # Starts Convex dev server
npm run test   # Runs all tests
```

## Key Files

| File | Purpose |
|:-----|:--------|
| `convex.config.ts` | Register with `app.use(revenuecat)` |
| `http.ts` | Mount webhook handler with auth |
| `subscriptions.ts` | Use the `RevenueCat` client class |

> [!TIP]
> Check `subscriptions.ts` for complete usage examples including entitlement checks, subscription queries, and API integrations.
