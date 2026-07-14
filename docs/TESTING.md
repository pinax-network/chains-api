# Testing

The repository uses Vitest for unit, integration, and property-based tests.

```bash
npm ci
npm test
```

Additional checks:

```bash
npm run lint
npm run test:coverage
docker build -t chains-api:test .
```

Target a suite or file with Vitest directly:

```bash
npx vitest run tests/unit
npx vitest run tests/integration
npx vitest run tests/fuzz
npx vitest run tests/unit/http/metrics.test.js
```

Some tests deliberately exercise failed upstream requests, stale-cache recovery, invalid proxy settings, and retry paths. Error-level log lines from those cases are expected when the suite still exits successfully.

Before merging a deployment-related change, also start the production image and check both listeners:

```bash
docker run --rm -p 3000:3000 -p 3001:3001 chains-api:test
curl --fail http://localhost:3000/health
curl --fail http://localhost:3000/ui/
curl --fail http://localhost:3000/metrics
curl --fail http://localhost:3001/health
```

The checked-in OpenAPI document is generated with `npm run openapi`. Commit it whenever the generated API contract changes.
