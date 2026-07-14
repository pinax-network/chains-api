# Test suites

- `unit/` covers individual stores, services, routes, transports, and compatibility modules.
- `integration/` covers assembled REST, MCP, assistant, and data-flow behavior.
- `fuzz/` uses property-based tests for parsers and validation boundaries.
- `fixtures/` contains reusable test data.

Run everything with `npm test`, or pass a directory/file to `npx vitest run`. See [../docs/TESTING.md](../docs/TESTING.md) for the complete validation workflow.
