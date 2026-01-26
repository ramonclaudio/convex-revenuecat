# Example App

This directory contains an example Convex backend demonstrating the RevenueCat component.

## Structure

```
example/
├── .env.example       # Environment variables template
└── convex/
    ├── convex.config.ts   # Registers the component
    ├── http.ts            # Mounts webhook handler
    ├── subscriptions.ts   # Example queries/mutations
    └── *.test.ts          # Integration tests
```

## Setup

1. Copy `.env.example` and set your webhook auth:
   ```bash
   npx convex env set REVENUECAT_WEBHOOK_AUTH "your-secret-value"
   ```

2. Configure RevenueCat Dashboard:
   - Go to **Integrations** → **Webhooks**
   - Set webhook URL: `https://your-deployment.convex.site/webhooks/revenuecat`
   - Set **Authorization header** to match your `REVENUECAT_WEBHOOK_AUTH`

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
