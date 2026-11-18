import http from 'node:http';
import path from 'node:path';
import express from 'express';
import { createServerContext } from './app.js';

async function bootstrap() {
  const ctx = await createServerContext();
  const { app, config, db, indexerService } = ctx;
  const httpServer = http.createServer(app);

  // Start server-side blockchain listener & confirmation worker
  indexerService.startBackgroundWorker();

  if (config.nodeEnv !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        allowedHosts: true,
        hmr: {
          server: httpServer,
        },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const clientDist = path.resolve(process.cwd(), 'dist', 'client');
    app.use(express.static(clientDist));
    app.use((req, res, next) => {
      if (req.path.startsWith('/api/')) {
        next();
        return;
      }
      res.sendFile(path.join(clientDist, 'index.html'));
    });
  }

  httpServer.listen(config.port, '0.0.0.0', () => {
    console.log(
      `[RicsWallet] Server listening on http://0.0.0.0:${config.port} | DB: ${db.dialect} | Mode: ${config.bscRpcUrl ? 'LIVE BSC RPC' : 'DEVNET SIMULATOR'}`
    );
  });

  const shutdown = () => {
    indexerService.stopBackgroundWorker();
    httpServer.close(() => {
      void db.close().finally(() => process.exit(0));
    });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

bootstrap().catch((err) => {
  console.error('[RicsWallet] Fatal startup error:', err);
  process.exit(1);
});
