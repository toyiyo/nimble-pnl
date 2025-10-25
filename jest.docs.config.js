module.exports = {
  displayName: 'documentation',
  testEnvironment: 'node',
  testMatch: [
    '**/tests/documentation/**/*.test.js',
    '**/tests/documentation/**/*.spec.js'
  ],
  collectCoverageFrom: [
    '**/*.md',
    '!node_modules/**',
    '!coverage/**',
    '!**/node_modules/**'
  ],
  coveragePathIgnorePatterns: [
    '/node_modules/',
    '/tests/',
    '/coverage/'
  ],
  verbose: true,
  testTimeout: 10000,
  moduleFileExtensions: ['js', 'md'],
  transform: {},
  transformIgnorePatterns: ['node_modules']
};