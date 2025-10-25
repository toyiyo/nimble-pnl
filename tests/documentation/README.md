# Documentation Tests

Comprehensive test suite for markdown documentation files in the repository.

## Overview

These tests validate the quality, consistency, and accuracy of all documentation files that were added or modified in this branch:

- `.github/copilot-instructions.md` - AI coding assistant guidelines
- `ARCHITECTURE.md` - Technical architecture documentation
- `INTEGRATIONS.md` - Third-party integration patterns
- `README.md` - Project overview and quick start

## Test Suites

### 1. `markdown-structure.test.js`

Validates document structure and format:
- ✅ File existence and readability
- ✅ Header hierarchy and organization
- ✅ Code block formatting and language tags
- ✅ Content quality (no typos, proper lists)
- ✅ Security checks (no exposed secrets)
- ✅ Performance checks (file sizes, line lengths)
- ✅ Cross-document consistency

### 2. `link-validation.test.js`

Validates all links in documentation:
- ✅ Internal anchor links point to existing headers
- ✅ Relative file links point to existing files
- ✅ External links have valid URL format
- ✅ Link text is descriptive and accessible
- ✅ No broken or malformed links

### 3. `content-validation.test.js`

Validates document-specific content requirements:
- ✅ README.md has project description, features, setup
- ✅ ARCHITECTURE.md documents tech stack, patterns, design system
- ✅ INTEGRATIONS.md documents all integrations with examples
- ✅ copilot-instructions.md has rules, patterns, best practices
- ✅ Cross-document consistency in terminology

## Running Tests

```bash
# Run all documentation tests
npm run test:docs

# Run in watch mode (useful during development)
npm run test:docs:watch

# Run with coverage report
npm run test:docs:coverage

# Run specific test file
npm run test:docs -- markdown-structure.test.js

# Run tests matching pattern
npm run test:docs -- --testNamePattern="README"
```

## Test Coverage

Total test cases: **80+**

Coverage areas:
- Document structure: 25+ tests
- Link validation: 15+ tests
- Content quality: 20+ tests
- Security: 5+ tests
- Performance: 5+ tests
- Document-specific: 15+ tests

## Adding New Documentation

When adding new documentation files:

1. Add the file path to the `markdownFiles` object in each test file
2. Add document-specific tests in `content-validation.test.js`
3. Run the full test suite to ensure consistency
4. Update this README with the new file

## CI/CD Integration

These tests are designed to run in CI/CD pipelines:

```yaml
# GitHub Actions example
- name: Install dependencies
  run: npm install
  
- name: Run documentation tests
  run: npm run test:docs
```

## Test Philosophy

These tests follow the principle of **bias for action**:

- Comprehensive coverage of all documentation aspects
- Validation of structure, content, and formatting
- Security and performance checks
- Cross-document consistency verification
- Actionable error messages for quick fixes

## Troubleshooting

**Test failures for anchor links:**
- Anchor generation may differ slightly (especially with emojis/special chars)
- Check the console output for available anchors
- Verify the header text matches GitHub's anchor generation

**Link validation failures:**
- Ensure all relative paths are correct from the document location
- Check that referenced files exist in the repository
- External links should use `https://` where possible

**Content validation failures:**
- Review document-specific requirements in test files
- Ensure all required sections are present
- Check for consistent terminology across documents

## Contributing

When modifying documentation:

1. Run tests locally before committing
2. Fix any test failures
3. Add new tests for new content/requirements
4. Ensure all tests pass in CI/CD

## Resources

- [Jest Documentation](https://jestjs.io/)
- [Markdown Guide](https://www.markdownguide.org/)
- [WCAG Guidelines](https://www.w3.org/WAI/WCAG21/quickref/) (for accessibility)