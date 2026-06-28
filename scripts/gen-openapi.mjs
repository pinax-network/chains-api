#!/usr/bin/env node
// Generate the OpenAPI spec from the live route schemas and write it to
// public/openapi.json. Run by `npm run openapi` and in CI before the Pages
// deploy, so the published spec never drifts from the routes.
//
// The app is built with loadDataOnStartup:false — no network, no refreshers —
// because we only need the route table, not real data.
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from '../index.js';

const __dir = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dir, '..', 'public', 'openapi.json');

const app = await buildApp({ logger: false, loadDataOnStartup: false });
try {
  await app.ready();
  const spec = app.swagger();
  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(spec, null, 2) + '\n');
  const paths = Object.keys(spec.paths).length;
  // eslint-disable-next-line no-console
  console.log(`Wrote ${OUT} — OpenAPI ${spec.openapi}, ${paths} paths, v${spec.info.version}`);
} finally {
  await app.close();
}
