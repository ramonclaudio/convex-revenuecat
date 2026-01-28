# Contributing

## Project Structure

```
src/
├── client/           # Client SDK (RevenueCat class)
│   └── index.ts      # Main export, httpHandler
├── component/        # Convex component (backend)
│   ├── schema.ts     # Database tables
│   ├── handlers.ts   # Webhook event handlers
│   ├── webhooks.ts   # Webhook processing + rate limiting
│   ├── entitlements.ts
│   ├── subscriptions.ts
│   ├── customers.ts
│   ├── cleanup.ts    # Scheduled cleanup
│   └── crons.ts      # Cron definitions
└── test.ts           # Test utilities
example/
└── convex/           # Example implementation
```

## Development

```bash
npm install
npm run dev       # Start Convex dev server + watch mode
npm run all       # Dev server + test watch
```

## Testing

```bash
npm run test              # Run all tests
npm run test -- --watch   # Watch mode
npm run test -- handlers  # Run specific file
npm run typecheck         # Type check
npm run lint              # ESLint
```

## Building

```bash
npm run build         # Build to dist/
npm run build:clean   # Clean + rebuild
npm run build:codegen # Regenerate Convex types
```

## Pull Requests

1. Fork and create a feature branch
2. Make changes with tests
3. Run `npm run test && npm run lint && npm run typecheck`
4. Submit PR with clear description

## Code Style

- TypeScript strict mode
- All Convex functions must have `args` and `returns` validators
- Use `internalMutation` for write operations called by handlers
- Keep functions focused and small
