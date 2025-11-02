// bookAgent.ts

import { Agent } from '@mastra/core';
import axios, { AxiosError } from 'axios';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { ExternalAPIError, ValidationError } from './types.js';
import { InputSanitizer } from './validation.js';

// --- 1. Define the Agent's Tool (its capability) ---
// This tool knows how to talk to the Project Gutenberg API.
const extractBookExcerptTool = createTool({
  id: 'extractBookExcerpt',
  description: 'Searches for a public domain book on Project Gutenberg and returns a short excerpt.',
  inputSchema: z.object({
    searchQuery: z.string()
      .min(1, 'Search query is required')
      .max(200, 'Search query is too long (max 200 characters)')
      .transform(val => InputSanitizer.sanitizeSearchQuery(val))
      .describe('The query to search for a book, e.g., "Sherlock Holmes" or "Pride and Prejudice"'),
  }),
  execute: async ({ context }) => {
    const { searchQuery } = context;
    console.log(`🔍 Searching for book with query: "${searchQuery}"`);
    
    try {
      // Validate search query
      if (!searchQuery || searchQuery.trim().length === 0) {
        throw new ValidationError('Search query cannot be empty');
      }
      
      // Search for the book with timeout and retry logic
      const searchResponse = await searchGutenbergBooks(searchQuery);
      
      if (!searchResponse.data || !Array.isArray(searchResponse.data.results)) {
        throw new ExternalAPIError(
          'Invalid response format from Gutenberg API',
          'gutendex'
        );
      }
      
      if (searchResponse.data.results.length === 0) {
        return {
          error: 'No books found for that query.',
          suggestions: [
            'Try using different keywords',
            'Check spelling of author names or book titles',
            'Try more general search terms'
          ]
        };
      }

      // Get the first book from results
      const book = searchResponse.data.results[0];
      
      // Validate book data structure
      if (!book || typeof book !== 'object') {
        throw new ExternalAPIError(
          'Invalid book data structure from Gutenberg API',
          'gutendex'
        );
      }
      
      const title = book.title || 'Unknown Title';
      const authors = Array.isArray(book.authors)
        ? book.authors.map((a: any) => a?.name || 'Unknown Author').join(', ')
        : 'Unknown Author';

      // Find the link to the plain text file
      const textUrl = book.formats?.['text/plain; charset=us-ascii'] ||
                     book.formats?.['text/plain'] ||
                     book.formats?.['text/plain; charset=utf-8'];
      
      if (!textUrl) {
        return {
          error: `Found book "${title}" but no plain text version is available.`,
          availableFormats: Object.keys(book.formats || {}),
          title,
          authors
        };
      }
      
      // Validate URL format
      try {
        new URL(textUrl);
      } catch {
        throw new ExternalAPIError(
          `Invalid text URL format for book "${title}"`,
          'gutendex'
        );
      }
      
      // Fetch the content of the book with timeout
      const contentResponse = await fetchBookContent(textUrl, title);
      const fullText = contentResponse.data;
      
      // Validate content
      if (!fullText || typeof fullText !== 'string') {
        throw new ExternalAPIError(
          `Invalid content format for book "${title}"`,
          'gutendex'
        );
      }
      
      // Extract a small excerpt with proper handling
      const excerpt = extractCleanExcerpt(fullText, title);

      console.log(`✅ Successfully extracted excerpt for "${title}"`);
      return {
        title,
        authors,
        excerpt,
        source: 'Project Gutenberg',
        downloadCount: book.download_count || 0,
        languages: book.languages || [],
        subjects: book.subjects || [],
      };

    } catch (error) {
      console.error("❌ Error fetching book:", error);
      
      if (error instanceof ValidationError || error instanceof ExternalAPIError) {
        return {
          error: error.message,
          code: error.code,
          details: error instanceof ValidationError ? error.details : error.service
        };
      }
      
      // Handle axios errors specifically
      if (axios.isAxiosError(error)) {
        return handleAxiosError(error, searchQuery);
      }
      
      return {
        error: 'An unexpected error occurred while fetching book data.',
        code: 'UNKNOWN_ERROR',
        details: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  },
});

// Helper function to search Gutenberg books with retry logic
async function searchGutenbergBooks(searchQuery: string, maxRetries: number = 3): Promise<any> {
  const baseUrl = 'https://gutendex.com/books';
  const encodedQuery = encodeURIComponent(searchQuery);
  const url = `${baseUrl}?search=${encodedQuery}`;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await axios.get(url, {
        timeout: 10000, // 10 second timeout
        headers: {
          'User-Agent': 'A2A-Book-Agent/1.0.0',
          'Accept': 'application/json',
        },
      });
      
      return response;
    } catch (error) {
      if (attempt === maxRetries) {
        throw error;
      }
      
      // Wait before retrying (exponential backoff)
      const delay = Math.pow(2, attempt) * 1000;
      console.log(`⚠️ Search attempt ${attempt} failed, retrying in ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

// Helper function to fetch book content with error handling
async function fetchBookContent(textUrl: string, bookTitle: string): Promise<any> {
  try {
    const response = await axios.get(textUrl, {
      timeout: 15000, // 15 second timeout for larger texts
      headers: {
        'User-Agent': 'A2A-Book-Agent/1.0.0',
        'Accept': 'text/plain',
      },
      maxContentLength: 10 * 1024 * 1024, // 10MB max
    });
    
    return response;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      if (error.code === 'ECONNABORTED') {
        throw new ExternalAPIError(
          `Timeout while fetching content for "${bookTitle}"`,
          'gutendex'
        );
      }
      if (error.response?.status === 404) {
        throw new ExternalAPIError(
          `Book content not found for "${bookTitle}"`,
          'gutendex'
        );
      }
    }
    throw error;
  }
}

// Helper function to extract a clean excerpt
function extractCleanExcerpt(fullText: string, bookTitle: string): string {
  // Remove common Project Gutenberg headers/footers
  const cleanedText = fullText
    .replace(/.*?Project Gutenberg.*?[\r\n]+/gi, '')
    .replace(/[\r\n]+.*?End of Project Gutenberg.*$/gi, '')
    .replace(/[\r\n]+.*?END OF.*?PROJECT GUTENBERG.*$/gi, '');
  
  // Find a good starting point (skip table of contents, etc.)
  const lines = cleanedText.split(/[\r\n]+/).filter(line => line.trim().length > 0);
  
  let startIndex = 0;
  for (let i = 0; i < Math.min(20, lines.length); i++) {
    const line = lines[i].trim();
    // Skip lines that look like table of contents or headers
    if (line.length > 50 &&
        !line.match(/^(chapter|contents|index|table of contents)/i) &&
        !line.match(/^[IVX]+\.?\s*$/i) &&
        !line.match(/^\d+\.?\s*$/)) {
      startIndex = i;
      break;
    }
  }
  
  // Extract excerpt from the best starting point
  const excerptLines = lines.slice(startIndex, startIndex + 10);
  let excerpt = excerptLines.join(' ').trim();
  
  // Clean up the excerpt
  excerpt = excerpt
    .replace(/\s+/g, ' ')
    .replace(/[""]/g, '"')
    .replace(/['']/g, "'")
    .replace(/[^\w\s.,!?;:'"()-]/g, '');
  
  // Ensure reasonable length
  if (excerpt.length > 500) {
    excerpt = excerpt.substring(0, 497) + '...';
  } else if (excerpt.length < 100 && startIndex + 10 < lines.length) {
    // If excerpt is too short, try to get more content
    const moreLines = lines.slice(startIndex + 10, startIndex + 20);
    const moreText = moreLines.join(' ').trim();
    excerpt = (excerpt + ' ' + moreText).substring(0, 497) + '...';
  }
  
  return excerpt || 'Excerpt not available for this book.';
}

// Helper function to handle axios errors
function handleAxiosError(error: AxiosError, searchQuery: string): any {
  if (error.code === 'ECONNABORTED') {
    return {
      error: 'Request timeout while searching for books',
      code: 'TIMEOUT_ERROR',
      details: 'The search request took too long to complete'
    };
  }
  
  if (error.response) {
    const status = error.response.status;
    switch (status) {
      case 429:
        return {
          error: 'Too many requests to Gutenberg API',
          code: 'RATE_LIMIT_ERROR',
          details: 'Please try again later'
        };
      case 500:
      case 502:
      case 503:
        return {
          error: 'Gutenberg API is temporarily unavailable',
          code: 'SERVICE_UNAVAILABLE',
          details: 'Please try again later'
        };
      case 404:
        return {
          error: 'Gutenberg API endpoint not found',
          code: 'API_NOT_FOUND',
          details: 'The search service is currently unavailable'
        };
      default:
        return {
          error: `Gutenberg API returned error ${status}`,
          code: 'API_ERROR',
          details: error.response.data || 'Unknown API error'
        };
    }
  }
  
  if (error.request) {
    return {
      error: 'Unable to connect to Gutenberg API',
      code: 'CONNECTION_ERROR',
      details: 'Please check your internet connection'
    };
  }
  
  return {
    error: 'An unexpected error occurred while searching for books',
    code: 'UNKNOWN_ERROR',
    details: error.message
  };
}

// --- 2. Create the Mastra Agent ---
export const bookExtractorAgent = new Agent({
  name: 'Public Domain Book Extractor',
  id: 'book-extractor-001', // This unique ID is important
  instructions: 'You are an agent that extracts excerpts from public domain books. Use the extractBookExcerptTool tool to fulfill requests.',
  model: 'openai/gpt-4o-mini', // The model is used for reasoning, the tool does the work
  tools: {
    extractBookExcerptTool,
  },
});
