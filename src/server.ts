import { buildApp } from './app.js';
import { loadEnv } from './config/env.js';

const env = loadEnv();
const app = await buildApp({
  logger: env.nodeEnv === 'test' ? false : { level: env.logLevel }
});

try {
  await app.listen({ host: '0.0.0.0', port: env.port });
  app.log.info({ port: env.port }, 'clever-delivery-server listening');
} catch (error) {
  app.log.error(error, 'failed to start clever-delivery-server');
  process.exitCode = 1;
}
