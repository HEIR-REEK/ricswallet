import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

export function computeSourceStamp() {
  const hash = crypto.createHash('sha256');
  const walk = (targetPath) => {
    if (!fs.existsSync(targetPath)) return;
    const stat = fs.statSync(targetPath);
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(targetPath).sort()) {
        walk(path.join(targetPath, entry));
      }
    } else if (stat.isFile()) {
      hash.update(path.relative(rootDir, targetPath));
      hash.update(fs.readFileSync(targetPath));
    }
  };

  walk(path.join(rootDir, 'src'));
  walk(path.join(rootDir, 'index.html'));
  walk(path.join(rootDir, 'package.json'));
  walk(path.join(rootDir, 'tsconfig.json'));
  walk(path.join(rootDir, 'tsconfig.server.json'));
  walk(path.join(rootDir, 'vite.config.ts'));
  return hash.digest('hex');
}

export function isBuildUpToDate() {
  const serverEntry = path.join(rootDir, 'dist', 'server', 'index.js');
  const clientIndex = path.join(rootDir, 'dist', 'client', 'index.html');
  const stampFile = path.join(rootDir, 'dist', '.build-stamp');

  if (!fs.existsSync(serverEntry) || !fs.existsSync(clientIndex) || !fs.existsSync(stampFile)) {
    return false;
  }

  const savedStamp = fs.readFileSync(stampFile, 'utf8').trim();
  return savedStamp === computeSourceStamp();
}

export function runProductionBuild({ force = false } = {}) {
  if (!force && isBuildUpToDate()) {
    console.log('[RicsWallet Build] dist/ is already up to date.');
    return;
  }

  const viteCli = path.join(rootDir, 'node_modules', 'vite', 'bin', 'vite.js');
  const tscCli = path.join(rootDir, 'node_modules', 'typescript', 'bin', 'tsc');

  if (!fs.existsSync(viteCli) || !fs.existsSync(tscCli)) {
    console.log('[RicsWallet Build] Build tools not installed yet; skipping postinstall build.');
    return;
  }

  console.log('[RicsWallet Build] Building frontend (Vite) -> dist/client ...');
  execFileSync(process.execPath, [viteCli, 'build'], {
    cwd: rootDir,
    stdio: 'inherit',
  });

  console.log('[RicsWallet Build] Compiling backend (TypeScript) -> dist/server ...');
  execFileSync(process.execPath, [tscCli, '-p', 'tsconfig.server.json'], {
    cwd: rootDir,
    stdio: 'inherit',
  });

  const stampFile = path.join(rootDir, 'dist', '.build-stamp');
  fs.mkdirSync(path.dirname(stampFile), { recursive: true });
  fs.writeFileSync(stampFile, computeSourceStamp(), 'utf8');
  console.log('[RicsWallet Build] Production build complete.');
}

// Run directly if invoked via `node scripts/build.mjs`
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const force = process.argv.includes('--force');
  runProductionBuild({ force });
}
