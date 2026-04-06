/**
 * Test setup and utilities
 */

import { before, after } from "node:test";

// Test configuration
export const TEST_CONFIG = {
  timeout: 5000, // 5 second default timeout
} as const;

// Setup function
export function setupTests() {
  console.log("Setting up test environment...");
}

// Teardown function
export function teardownTests() {
  console.log("Cleaning up test environment...");
}

// Run setup before tests
before(setupTests);

// Run teardown after tests
after(teardownTests);
