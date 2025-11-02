// bookWorkflow.ts

import { createWorkflow } from '@mastra/core/workflows';
import { bookExtractorAgent } from './bookAgent.js';
import { z } from 'zod';
import {
  BookExtractionResult,
  BookExtractionError,
  ValidationError,
  ExternalAPIError,
  ToolExecutionContext
} from './types.js';

// This workflow simply triggers our agent with enhanced error handling and type safety.
export const bookExcerptWorkflow = createWorkflow({
  id: 'book-excerpt-workflow',
  description: 'Finds a book and returns an excerpt with comprehensive error handling.',
  inputSchema: z.object({
    searchQuery: z.string()
      .min(1, 'Search query is required')
      .max(200, 'Search query is too long (max 200 characters)')
      .describe('The query to search for a book'),
  }),
  outputSchema: z.union([
    z.object({
      success: z.literal(true),
      data: z.object({
        title: z.string(),
        authors: z.string(),
        excerpt: z.string(),
        source: z.string(),
        downloadCount: z.number().optional(),
        languages: z.array(z.string()).optional(),
        subjects: z.array(z.string()).optional(),
      }),
    }),
    z.object({
      success: z.literal(false),
      error: z.object({
        code: z.string(),
        message: z.string(),
        details: z.any().optional(),
        suggestions: z.array(z.string()).optional(),
      }),
    }),
  ]),
  // The step executes the agent with enhanced error handling
  steps: [
    {
      id: 'validate-input',
      inputSchema: z.object({
        searchQuery: z.string(),
      }),
      outputSchema: z.object({
        searchQuery: z.string(),
        isValid: z.boolean(),
      }),
      execute: async ({ inputData }) => {
        const { searchQuery } = inputData;
        
        try {
          // Basic validation
          if (!searchQuery || typeof searchQuery !== 'string') {
            throw new ValidationError('Search query must be a non-empty string');
          }
          
          const trimmedQuery = searchQuery.trim();
          if (trimmedQuery.length === 0) {
            throw new ValidationError('Search query cannot be empty');
          }
          
          if (trimmedQuery.length > 200) {
            throw new ValidationError('Search query is too long (max 200 characters)');
          }
          
          // Check for potentially dangerous content
          const dangerousPatterns = [
            /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
            /javascript:/gi,
            /on\w+\s*=/gi,
          ];
          
          for (const pattern of dangerousPatterns) {
            if (pattern.test(trimmedQuery)) {
              throw new ValidationError('Search query contains potentially dangerous content');
            }
          }
          
          return {
            searchQuery: trimmedQuery,
            isValid: true,
          };
        } catch (error) {
          if (error instanceof ValidationError) {
            throw error;
          }
          throw new ValidationError('Invalid search query format');
        }
      },
    },
    {
      id: 'extract-excerpt',
      inputSchema: z.object({
        searchQuery: z.string(),
        isValid: z.boolean(),
      }),
      outputSchema: z.union([
        z.object({
          success: z.literal(true),
          data: z.object({
            title: z.string(),
            authors: z.string(),
            excerpt: z.string(),
            source: z.string(),
            downloadCount: z.number().optional(),
            languages: z.array(z.string()).optional(),
            subjects: z.array(z.string()).optional(),
          }),
        }),
        z.object({
          success: z.literal(false),
          error: z.object({
            code: z.string(),
            message: z.string(),
            details: z.any().optional(),
            suggestions: z.array(z.string()).optional(),
          }),
        }),
      ]),
      execute: async ({ inputData }) => {
        const { searchQuery, isValid } = inputData;
        
        // Skip if validation failed
        if (!isValid) {
          return {
            success: false as const,
            error: {
              code: 'VALIDATION_FAILED',
              message: 'Invalid search query',
            },
          };
        }
        
        try {
          console.log(`🔍 Workflow: Processing book extraction for: "${searchQuery}"`);
          
          // Add timeout to prevent hanging requests
          const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Request timeout')), 30000);
          });
          
          // Execute agent with timeout
          const extractionPromise = bookExtractorAgent.generate(
            `Find a book with: query: ${searchQuery}`
          );
          
          const result = await Promise.race([extractionPromise, timeoutPromise]) as any;
          
          // Validate result structure
          if (!result || typeof result !== 'object') {
            throw new ExternalAPIError(
              'Invalid response from book extraction agent',
              'book-extractor-agent'
            );
          }
          
          // Check if result contains an error
          if (result.error) {
            return {
              success: false as const,
              error: {
                code: result.code || 'EXTRACTION_ERROR',
                message: result.error,
                details: result.details,
                suggestions: result.suggestions,
              },
            };
          }
          
          // Validate required fields
          if (!result.title || !result.authors || !result.excerpt) {
            throw new ValidationError(
              'Invalid book extraction result: missing required fields'
            );
          }
          
          console.log(`✅ Workflow: Successfully extracted excerpt for "${result.title}"`);
          
          return {
            success: true as const,
            data: {
              title: result.title,
              authors: result.authors,
              excerpt: result.excerpt,
              source: result.source || 'Unknown',
              downloadCount: result.downloadCount,
              languages: result.languages || [],
              subjects: result.subjects || [],
            },
          };
          
        } catch (error) {
          console.error('❌ Workflow: Error in book extraction:', error);
          
          // Handle specific error types
          if (error instanceof ValidationError) {
            return {
              success: false as const,
              error: {
                code: 'VALIDATION_ERROR',
                message: error.message,
                details: error.details,
              },
            };
          }
          
          if (error instanceof ExternalAPIError) {
            return {
              success: false as const,
              error: {
                code: 'EXTERNAL_API_ERROR',
                message: error.message,
                details: { service: error.service, code: error.code },
              },
            };
          }
          
          if (error instanceof Error && error.message === 'Request timeout') {
            return {
              success: false as const,
              error: {
                code: 'TIMEOUT_ERROR',
                message: 'Book extraction request timed out',
                details: { timeout: 30000 },
              },
            };
          }
          
          // Handle unknown errors
          return {
            success: false as const,
            error: {
              code: 'UNKNOWN_ERROR',
              message: 'An unexpected error occurred during book extraction',
              details: error instanceof Error ? error.message : 'Unknown error',
            },
          };
        }
      },
    },
  ],
});
