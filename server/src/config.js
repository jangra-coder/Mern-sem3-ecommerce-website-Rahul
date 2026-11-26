// Loads settings from server/.env.
// On first run the file is created automatically with a random secret,
// so no secret is ever hard-coded in the source.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envPath = path.join(serverRoot, '.env');

if (!fs.existsSync(envPath)) {
  const secret = crypto.randomBytes(48).toString('hex');
  fs.writeFileSync(
    envPath,
    `PORT=4000\nMONGO_URI=mongodb://127.0.0.1:27017/layerforge\nJWT_SECRET=${secret}\n`,
    { mode: 0o600 } // readable only by you
  );
}
process.loadEnvFile(envPath); // does not override variables that are already set

const isTest = process.env.NODE_ENV === 'test';

export const config = {
  isTest,
  port: Number(process.env.PORT) || 4000,
  // Only listen on this computer - the site is not reachable from the network.
  host: '127.0.0.1',
  mongoUri: process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/layerforge',
  jwtSecret: process.env.JWT_SECRET,
  bcryptRounds: isTest ? 4 : 12,
  clientDist: path.resolve(serverRoot, '..', 'client', 'dist'),
};

if (!config.jwtSecret || config.jwtSecret.length < 32) {
  throw new Error('JWT_SECRET in server/.env is missing or too short (need 32+ characters).');
}
