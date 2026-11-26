// Builds the Express app. Kept separate from server.js so tests can use it.
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { config } from './config.js';
import { authRouter } from './auth.js';
import { orderRouter, productRouter } from './shop.js';

// Pages that are allowed to send changes to the API: the site itself,
// and the Vite dev server used during development.
const allowedOrigins = new Set(
  [config.port, 5173].flatMap((port) => [`http://localhost:${port}`, `http://127.0.0.1:${port}`])
);

// CSRF protection (on top of the SameSite=Strict cookie): a request that
// changes data must come from our own pages and must be JSON, which a
// plain HTML form on another website cannot send.
function csrfGuard(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.get('origin');
  if (origin && !allowedOrigins.has(origin)) {
    return res.status(403).json({ error: 'Request blocked: unknown origin.' });
  }
  if (!req.is('application/json')) {
    return res.status(415).json({ error: 'Requests must be sent as JSON.' });
  }
  next();
}

export function createApp({ authLimit = 20 } = {}) {
  const app = express();
  app.disable('x-powered-by');

  // Security headers (content security policy, no-sniff, frame blocking...).
  app.use(
    helmet({
      contentSecurityPolicy: {
        // The site is served over http://localhost, so don't force https.
        directives: { upgradeInsecureRequests: null },
      },
      strictTransportSecurity: false,
    })
  );
  app.use(express.json({ limit: '20kb' })); // small bodies only
  app.use(cookieParser());
  app.use('/api', csrfGuard);

  // Slow down password guessing: a limited number of sign-up / log-in
  // attempts per 15 minutes.
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: authLimit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Too many attempts. Please wait a few minutes and try again.' },
  });
  app.use('/api/auth/login', authLimiter);
  app.use('/api/auth/register', authLimiter);

  app.use('/api/auth', authRouter);
  app.use('/api/products', productRouter);
  app.use('/api/orders', orderRouter);
  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

  // Serve the built React site (after "npm run build" in client/).
  const indexHtml = path.join(config.clientDist, 'index.html');
  if (fs.existsSync(indexHtml)) {
    app.use(express.static(config.clientDist));
    app.use((req, res, next) => {
      if (req.method !== 'GET') return next();
      res.sendFile(indexHtml); // let React Router handle the page URL
    });
  }

  // One place for all errors. Details go to the terminal, never to the browser.
  app.use((err, req, res, next) => {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: err.issues[0]?.message || 'Invalid input.' });
    }
    if (err.type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'Request body is not valid JSON.' });
    }
    if (err.type === 'entity.too.large') {
      return res.status(413).json({ error: 'Request is too large.' });
    }
    if (!config.isTest) console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  });

  return app;
}
