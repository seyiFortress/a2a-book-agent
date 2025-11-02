// server.ts

import express from 'express';
import cors from 'cors';
import 'dotenv/config'; // Load environment variables

// Import the mastra instance from mastra.ts
import { mastra } from './mastra.js';

// Import our agent and workflow
import { bookExtractorAgent } from './bookAgent.js';

// Import validation and error handling utilities
import {
  EnvironmentValidator,
  handleError,
  validateRequest,
  rateLimit,
  schemas,
  ValidationError,
  EnvironmentError
} from './validation.js';

// Types for Express
import { Request, Response, NextFunction } from 'express';

// --- 1. Validate environment variables on startup ---
const logger = mastra.getLogger();

try {
  EnvironmentValidator.validate();
  logger.info('Environment variables validated successfully');
} catch (error) {
  if (error instanceof Error && error.constructor.name === 'EnvironmentError') {
    logger.error('Environment validation failed', { error: error.message });
    process.exit(1);
  } else {
    logger.error('Unexpected error during environment validation', { error });
    process.exit(1);
  }
}

// --- 2. Create Express app for custom endpoints only ---
const app = express();

// Security headers middleware
app.use((req, res, next) => {
  // Set security headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  
  // In production, add additional security headers
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  
  next();
});

// Enable CORS for all routes
app.use(cors({
  origin: process.env.NODE_ENV === 'production'
    ? (process.env.ALLOWED_ORIGINS?.split(',') || ['https://telex.im'])
    : '*', // Allow all origins in development
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  credentials: true,
}));

// Parse JSON bodies with size limit
app.use(express.json({
  limit: '10mb',
  verify: (req: any, res, buf) => {
    try {
      JSON.parse(buf.toString());
    } catch (e) {
      throw new Error('Invalid JSON in request body');
    }
  }
}));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Apply rate limiting to all requests
app.use(rateLimit(
  parseInt(EnvironmentValidator.getOptional('RATE_LIMIT_MAX', '100'), 10),
  parseInt(EnvironmentValidator.getOptional('RATE_LIMIT_WINDOW_MS', '60000'), 10)
));

// Request logging middleware with enhanced information
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  const userAgent = req.get('User-Agent') || 'Unknown';
  logger.info('Incoming request', {
    method: req.method,
    path: req.path,
    ip: req.ip,
    userAgent,
    timestamp
  });
  
  // Log request body in development (excluding sensitive data)
  if (process.env.NODE_ENV === 'development' && req.body) {
    const sanitizedBody = { ...req.body };
    // Remove potential sensitive fields
    delete sanitizedBody.password;
    delete sanitizedBody.token;
    delete sanitizedBody.apiKey;
    logger.debug('Request body', { body: sanitizedBody });
  }
  
  next();
});

// --- 3. Health check endpoint ---
app.get('/health', (req, res) => {
  try {
    const healthCheck = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      service: 'a2a-book-agent',
      version: '1.0.0',
      environment: process.env.NODE_ENV || 'unknown',
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      dependencies: {
        mastra: 'OK',
        express: 'OK'
      }
    };
    
    res.status(200).json(healthCheck);
  } catch (error) {
    logger.error('Health check error', { error });
    res.status(500).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: 'Health check failed'
    });
  }
});

// --- 4. Simple book extraction API endpoint ---
app.post('/api/extract-book',
  validateRequest(schemas.bookExtractionRequest),
  async (req, res, next) => {
    try {
      const { searchQuery } = req.body;
      
      logger.info('Processing book extraction request', { searchQuery });
      
      // Use the agent to extract book excerpt
      const result = await bookExtractorAgent.generate(`Find a book with: query: ${searchQuery}`);
      
      logger.info('Successfully processed book extraction', { searchQuery });
      
      res.status(200).json({
        success: true,
        data: result,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Error in book extraction', {
        error: error instanceof Error ? error.message : error,
        searchQuery: req.body?.searchQuery
      });
      next(error);
    }
  }
);

// --- 5. Agent Card Endpoint for A2A Discovery ---
app.get('/.well-known/agent.json', (req, res) => {
  const agentCard = {
    name: 'Public Domain Book Extractor',
    description: 'An A2A-enabled agent that extracts excerpts from public domain books using Project Gutenberg',
    version: '1.0.0',
    capabilities: {
      streaming: true,
      pushNotifications: false
    },
    provider: {
      organization: 'A2A Book Agent',
      url: 'https://github.com/seyiFortress/a2a-book-agent'
    },
    executionUrl: '/a2a/book-extractor-001',
    defaultInputModes: ['text'],
    defaultOutputModes: ['text'],
    skills: [
      {
        name: 'extractBookExcerpt',
        description: 'Searches for a public domain book on Project Gutenberg and returns a short excerpt',
        inputModes: ['text'],
        outputModes: ['text']
      }
    ],
    extensions: [
      {
        name: 'telex-im-integration',
        description: 'Enhanced integration with Telex.im platform',
        version: '1.0.0',
        methods: [
          'message/send',
          'message/stream',
          'tasks/get',
          'tasks/cancel',
          'tasks/setPushNotificationConfig',
          'tasks/getPushNotificationConfig',
          'tasks/resubscribe'
        ]
      }
    ]
  };
  
  res.json(agentCard);
});

// --- 6. Error handling middleware ---
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  handleError(err, req, res);
});

// --- 7. 404 handler ---
app.use((req, res) => {
  const error = new Error(`Route ${req.method} ${req.path} not found`);
  (error as any).statusCode = 404;
  (error as any).code = 'NOT_FOUND';
  handleError(error, req, res);
});

// --- 8. Graceful shutdown handling ---
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully...');
  process.exit(0);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception', { error });
  process.exit(1);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection', { reason, promise });
  process.exit(1);
});

// --- 9. Start the server with Mastra ---
async function main() {
  logger.info('Starting Public Domain Book Extractor Agent...');
  
  try {
    const port = parseInt(EnvironmentValidator.getOptional('PORT', '4111'), 10);
    const host = EnvironmentValidator.getOptional('HOST', 'localhost');
    
    // Start the Express server with Mastra's middleware
    const server = app.listen(port, host, () => {
      logger.info('Server started successfully!', {
        port,
        host,
        endpoints: {
          server: `http://${host}:${port}`,
          a2a: `http://${host}:${port}/a2a/book-extractor-001`,
          agentCard: `http://${host}:${port}/.well-known/agent.json`,
          bookAPI: `http://${host}:${port}/api/extract-book`,
          health: `http://${host}:${port}/health`
        },
        environment: process.env.NODE_ENV || 'development'
      });
    });
    
    // Handle graceful shutdown
    server.on('close', () => {
      logger.info('Server closed');
    });
  } catch (error) {
    logger.error('Failed to start server', { error });
    process.exit(1);
  }
}

main().catch((error) => {
  logger.error('Failed to start agent', { error });
  process.exit(1);
});
