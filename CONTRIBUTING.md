# Contributing to Nimble P&L

Thank you for your interest in contributing to Nimble P&L! This document provides guidelines for contributing to the project.

## Getting Started

1. Fork the repository
2. Clone your fork: `git clone https://github.com/your-username/nimble-pnl.git`
3. Install dependencies: `npm install`
4. Create a branch: `git checkout -b feature/your-feature-name`

## Development Setup

### Prerequisites
- Node.js 18+
- npm 9+
- Git
- Supabase account (for full functionality)

### Local Development
```bash
# Start development server
npm run dev

# Run linting
npm run lint

# Build project
npm run build
```

## Code Style

- Use TypeScript for all new code
- Follow existing code patterns and naming conventions
- Use ESLint configuration provided in the project
- Write meaningful commit messages following conventional commits

### TypeScript Guidelines
- Use strict type checking
- Avoid `any` types when possible
- Create interfaces for data structures
- Use proper generic types for reusable components

### React Guidelines
- Use functional components with hooks
- Follow the custom hooks pattern for data fetching
- Use proper error boundaries for error handling
- Implement proper loading states

## Pull Request Process

1. Update documentation for any new features
2. Ensure all tests pass and linting is clean
3. Update the README.md if needed
4. Write a clear pull request description
5. Link any related issues

## Bug Reports

When filing bug reports, please include:
- Clear description of the issue
- Steps to reproduce
- Expected vs actual behavior
- Browser/environment information
- Screenshots if applicable

## Feature Requests

For feature requests, please:
- Check if similar requests exist
- Provide clear use case description
- Explain the expected behavior
- Consider implementation complexity

## Questions

For questions about the codebase or development:
- Check existing documentation
- Search through existing issues
- Create a new discussion thread

Thank you for contributing!