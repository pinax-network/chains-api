# Project structure

```text
chains-api/
├── .github/workflows/       CI and GHCR publishing
├── data/                    Curated mappings and fallback datasets
├── docs/                    Maintainer and testing documentation
├── public/                  Dashboard, static OpenAPI JSON, and assets
├── scripts/                 OpenAPI generation
├── src/
│   ├── http/                Fastify app and REST route plugins
│   ├── services/            Loading, refresh, RPC, L2BEAT, and assistant logic
│   ├── sources/             External incident, forum, and registry adapters
│   ├── store/               Shared in-memory cache and query functions
│   ├── transport/           Resilient upstream fetch utilities
│   └── util/                Logging and Prometheus exposition
├── tests/
│   ├── fixtures/            Shared test data
│   ├── fuzz/                Property-based tests
│   ├── integration/         HTTP and end-to-end component tests
│   └── unit/                Focused module tests mirroring the source layout
├── index.js                 REST-only compatibility entry point
├── mcp-server.js            Stdio MCP entry point
├── mcp-server-http.js       MCP HTTP application and standalone entry point
└── server.js                Default combined REST + MCP process
```

`server.js` is the production entry point. It starts Fastify on port 3000 and MCP HTTP on port 3001 in one process so both surfaces share a single cache and background refresh cycle.

The root-level modules such as `dataService.js` and `rpcMonitor.js` preserve the public API used by older consumers while implementation is organized under `src/`.
