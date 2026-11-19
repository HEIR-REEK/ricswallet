import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isBuildUpToDate, runProductionBuild } from './build.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

async function start() {
  process.env.NODE_ENV = process.env.NODE_ENV || 'production';

  if (!isBuildUpToDate()) {
    console.log('[RicsWallet] Compiled dist/ missing or outdated — building automatically before start...');
    runProductionBuild({ force: true });
  }

  const serverEntry = path.join(rootDir, 'dist', 'server', 'index.js');
  await import(pathToFileURL(serverEntry).href);
}

start().catch((err) => {
  console.error('[RicsWallet] Failed to start server:', err);
  process.exit(1);
});
