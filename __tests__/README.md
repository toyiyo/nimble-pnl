# Documentation Tests

This directory contains comprehensive test suites for validating the markdown documentation files in this repository.

## Test Structure

### markdown-validation.test.js
Comprehensive tests covering:
- File existence and readability
- Structure and content validation for each document
- Cross-document consistency
- Link validation
- Code block validation
- Content quality checks
- Formatting consistency
- Security best practices
- Edge cases and error conditions
- Performance and size checks

### link-validation.test.js
Focused tests for link validation:
- Internal anchor link validation
- Relative file link validation
- Cross-reference validation
- External link format validation
- Link text quality
- Link accessibility
- Link organization

### content-specific.test.js
Document-specific tests:
- README.md specific requirements
- ARCHITECTURE.md specific requirements
- INTEGRATIONS.md specific requirements
- copilot-instructions.md specific requirements
- Cross-document content consistency

## Running Tests

```bash
# Install dependencies
npm install

# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage

# Run a specific test file
npm test -- markdown-validation.test.js
```

## Test Coverage

These tests cover:
- ✅ Markdown syntax validation
- ✅ Link integrity (internal and external)
- ✅ Header hierarchy and structure
- ✅ Code block formatting
- ✅ Content quality and consistency
- ✅ Security best practices
- ✅ Accessibility requirements
- ✅ Performance considerations
- ✅ Edge cases and error handling

## Adding New Tests

When adding new documentation files:
1. Add the file path to the `markdownFiles` object in each test file
2. Consider adding file-specific tests in `content-specific.test.js`
3. Run the full test suite to ensure consistency

## CI/CD Integration

These tests can be integrated into your CI/CD pipeline to ensure documentation quality:

```yaml
# Example GitHub Actions workflow
- name: Install dependencies
  run: npm install
  
- name: Run documentation tests
  run: npm test
```