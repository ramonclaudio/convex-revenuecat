# Example App

This directory contains an example Convex backend that demonstrates usage of the RevenueCat component.

## Structure

```
example/convex/
├── convex.config.ts  # Registers the RevenueCat component
├── http.ts           # Mounts the webhook handler
├── subscriptions.ts  # Example queries and mutations
└── *.test.ts         # Integration tests
```

## Running

From the repo root:

```bash
npm run dev    # Starts Convex dev server with codegen
npm run test   # Runs all tests including example app tests
```

## Key Files

- **convex.config.ts**: Shows how to register the component with `app.use(revenuecat)`
- **http.ts**: Shows how to mount the webhook handler with auth
- **subscriptions.ts**: Shows how to use the `RevenueCat` client class
