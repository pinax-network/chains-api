# Chains API

Chains API is a Node.js service that aggregates blockchain network metadata and serves it through a REST API, an interactive web dashboard, and an MCP HTTP endpoint. The REST API and MCP server share one in-memory data store and one background refresh loop.

Repository: [pinax-network/chains-api](https://github.com/pinax-network/chains-api)

## Service surfaces

| Surface | Local URL | Purpose |
| --- | --- | --- |
| Dashboard | `http://localhost:3000/ui/` | Browse networks, relations, incidents, and providers |
| REST API | `http://localhost:3000/` | Chain metadata, search, RPC health, and related datasets |
| OpenAPI | `http://localhost:3000/docs` | Interactive REST API reference |
| Prometheus | `http://localhost:3000/metrics` | Service, data freshness, RPC, assistant, and HTTP metrics |
| MCP HTTP | `http://localhost:3001/mcp` | Streamable HTTP MCP transport |
| Health | `http://localhost:3000/health` | Readiness and source freshness |

The development-cluster URL is `https://chains-api.riv-dev1.pinax.io`.

## Run locally

Node.js 20 or later is required.

```bash
npm ci
npm start
```

The initial data load calls public upstream registries and can take a short time. Copy `.env.example` to `.env` or export variables in your shell to override defaults.

For development with automatic restart:

```bash
npm run dev
```

## Run with Docker

Build and run the combined API and MCP service:

```bash
docker build -t chains-api .
docker run --rm -p 3000:3000 -p 3001:3001 chains-api
```

Or use Docker Compose:

```bash
docker compose up --build
```

Images built from `main` are published by `.github/workflows/docker-build.yml` to GitHub Container Registry with `latest` and immutable `<short-sha>-<unix-timestamp>` tags:

```bash
docker pull ghcr.io/pinax-network/chains-api:latest
```

Version tags such as `v1.7.14` also publish the corresponding semver image tag.

## Validate changes

```bash
npm run lint
npm test
npm run test:coverage
docker build -t chains-api:test .
```

The test suite covers the data sources and store, REST routes, MCP tools and transports, background refreshers, assistant orchestration, and browser-facing data contracts. See [docs/TESTING.md](docs/TESTING.md) for targeted commands.

## Configuration

All settings are environment variables. The complete documented list and defaults live in [.env.example](.env.example). The most common settings are:

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` / `HOST` | `3000` / `0.0.0.0` | REST and dashboard listener |
| `MCP_PORT` / `MCP_HOST` | `3001` / `0.0.0.0` | MCP HTTP listener |
| `CORS_ORIGIN` | `*` | Allowed REST origins, comma-separated when restricted |
| `RPC_MONITOR_LOOP` | `false` | Continuously refresh RPC health |
| `DATA_CACHE_ENABLED` | `true` | Use the stale-first disk cache |
| `SOURCE_REFRESH_INTERVAL_MS` | `900000` | Retry interval for failed registry sources |
| `ASSISTANT_LLM_URL` | unset | Enables the optional OpenAI-compatible assistant |
| `LIVE_INCIDENTS_URL` | hosted feed | Server-side incident feed used by assistant tools |
| `FORUM_NEWS_URL` | hosted feed | Server-side governance feed used by assistant tools |

The external source URLs can also be overridden. The defaults intentionally continue to use their upstream owners; repository ownership does not imply ownership of those external feeds.

## Metrics

`GET /metrics` exposes Prometheus text format, including:

- indexed chain count and source availability;
- data, L2BEAT, and RPC-check freshness;
- monitored RPC endpoint status;
- refresh, fetch, assistant, and self-healing counters;
- HTTP request count and latency by normalized route;
- process uptime and memory.

The Kubernetes deployment uses a `PodScrape` to collect these metrics. Dashboard source is maintained separately in [pinax-network/chains-api-grafana](https://github.com/pinax-network/chains-api-grafana).

## MCP modes

The default `npm start` command runs REST and MCP HTTP together. You can run an individual surface when needed:

```bash
npm run start:rest
npm run mcp:http
npm run mcp
```

`npm run mcp` uses stdio for local MCP clients. The HTTP transport supports `POST /mcp`, `GET /mcp`, and `DELETE /mcp`, with `GET /health` on port 3001.

## Project layout

The application is organized under `src/` by HTTP route, service, source, store, transport, and utility concerns. Compatibility entry points remain at the repository root. Static dashboard assets live in `public/`, registry fallbacks in `data/`, and tests in `tests/`.

See [docs/PROJECT_STRUCTURE.md](docs/PROJECT_STRUCTURE.md) for the current layout and [public/openapi.json](public/openapi.json) for the checked-in API specification.

## Contributing

Open an issue or pull request in [pinax-network/chains-api](https://github.com/pinax-network/chains-api). Pull requests should pass lint, tests, and the Docker build.
