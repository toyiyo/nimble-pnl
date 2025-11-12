#!/usr/bin/env node
/**
 * Test script to verify date extraction functionality
 * Run with: node tests/verify-date-extraction.js
 */

// Date parsing function from edge function
function parsePurchaseDate(dateString) {
  if (!dateString) return null;
  
  try {
    const date = new Date(dateString);
    const now = new Date();
    const minDate = new Date('2000-01-01');
    
    if (isNaN(date.getTime()) || date > now || date < minDate) {
      return null;
    }
    
    return date.toISOString().split('T')[0];
  } catch (error) {
    return null;
  }
}

// Filename date extraction function from edge function
function extractDateFromFilename(filename) {
  if (!filename) return null;
  
  const nameWithoutExt = filename.replace(/\.[^/.]+$/, '');
  
  // Pattern 1: YYYY-MM-DD or YYYY_MM_DD or YYYY.MM.DD
  const isoPattern = /(\d{4})[-_.\/](\d{1,2})[-_.\/](\d{1,2})/;
  const isoMatch = nameWithoutExt.match(isoPattern);
  if (isoMatch) {
    const [, year, month, day] = isoMatch;
    const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
    if (!isNaN(date.getTime())) {
      return date.toISOString().split('T')[0];
    }
  }
  
  // Pattern 2: MM-DD-YYYY or MM_DD_YYYY
  const usPattern = /(\d{1,2})[-_.\/](\d{1,2})[-_.\/](\d{4})/;
  const usMatch = nameWithoutExt.match(usPattern);
  if (usMatch) {
    const [, month, day, year] = usMatch;
    const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
    if (!isNaN(date.getTime())) {
      return date.toISOString().split('T')[0];
    }
  }
  
  return null;
}

// Test cases
const testCases = {
  parsePurchaseDate: [
    { input: '2024-01-15', expected: '2024-01-15', name: 'Valid ISO date' },
    { input: '2023-12-25', expected: '2023-12-25', name: 'Valid date in past' },
    { input: '2024-01-15T10:30:00', expected: '2024-01-15', name: 'ISO with time' },
    { input: 'January 15, 2024', expected: '2024-01-15', name: 'Text date format' },
    { input: '1999-12-31', expected: null, name: 'Date before 2000 (should reject)' },
    { input: 'not-a-date', expected: null, name: 'Invalid date string' },
    { input: '', expected: null, name: 'Empty string' },
    { input: undefined, expected: null, name: 'Undefined' },
  ],
  extractDateFromFilename: [
    { input: 'receipt-2024-01-15.pdf', expected: '2024-01-15', name: 'YYYY-MM-DD format' },
    { input: 'Invoice_2024-03-22.jpg', expected: '2024-03-22', name: 'YYYY-MM-DD with text' },
    { input: 'receipt_2024_01_15.pdf', expected: '2024-01-15', name: 'YYYY_MM_DD format' },
    { input: 'invoice.2024.03.22.jpg', expected: '2024-03-22', name: 'YYYY.MM.DD format' },
    { input: 'receipt-01-15-2024.pdf', expected: '2024-01-15', name: 'MM-DD-YYYY format' },
    { input: 'invoice_03_22_2024.jpg', expected: '2024-03-22', name: 'MM_DD_YYYY format' },
    { input: 'Sysco_Invoice_2024-01-15.pdf', expected: '2024-01-15', name: 'Real-world: Sysco' },
    { input: 'US-Foods-03-22-2024.pdf', expected: '2024-03-22', name: 'Real-world: US Foods' },
    { input: 'receipt.pdf', expected: null, name: 'No date in filename' },
    { input: 'my-receipt-file.jpg', expected: null, name: 'Text only filename' },
    { input: null, expected: null, name: 'Null filename' },
  ],
};

// Run tests
let passed = 0;
let failed = 0;

console.log('🧪 Testing Date Extraction Functions\n');

Object.entries(testCases).forEach(([functionName, cases]) => {
  console.log(`\n📋 Testing ${functionName}:`);
  console.log('─'.repeat(60));
  
  const testFunction = functionName === 'parsePurchaseDate' ? parsePurchaseDate : extractDateFromFilename;
  
  cases.forEach(({ input, expected, name }) => {
    const result = testFunction(input);
    const isPass = result === expected;
    
    if (isPass) {
      passed++;
      console.log(`✅ ${name}`);
      console.log(`   Input: ${JSON.stringify(input)} → Output: ${result}`);
    } else {
      failed++;
      console.log(`❌ ${name}`);
      console.log(`   Input: ${JSON.stringify(input)}`);
      console.log(`   Expected: ${expected}, Got: ${result}`);
    }
  });
});

// Summary
console.log('\n' + '═'.repeat(60));
console.log(`📊 Test Results: ${passed} passed, ${failed} failed`);
console.log('═'.repeat(60));

if (failed === 0) {
  console.log('🎉 All tests passed!');
  process.exit(0);
} else {
  console.log('⚠️  Some tests failed!');
  process.exit(1);
}
