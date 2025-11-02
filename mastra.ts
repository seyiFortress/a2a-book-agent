import { Mastra } from '@mastra/core/mastra';
import { createLogger } from '@mastra/core/logger';
import { InMemoryStore } from '@mastra/core/storage';
import { bookExtractorAgent } from './bookAgent.js';
import { a2aAgentRoute } from './a2a-agent-route.js';

export const mastra = new Mastra({
  agents: { bookExtractorAgent },
  storage: new InMemoryStore(),
  logger: createLogger({
    name: 'Mastra',
    level: 'debug',
  }),
  observability: {
    default: { enabled: true },
  },
  server: {
    build: {
      openAPIDocs: true,
      swaggerUI: true,
    }
  }
});