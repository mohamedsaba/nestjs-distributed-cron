module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: ['<rootDir>/test/**/*.spec.ts'],
  setupFiles: ['reflect-metadata'],
  // globalSetup: '<rootDir>/test/helpers/global-setup.ts',
  // globalTeardown: '<rootDir>/test/helpers/global-teardown.ts',
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.interface.ts',
    '!src/**/index.ts',
  ],
  coverageDirectory: 'coverage',
  coverageThreshold: {
    global: {
      lines: 90,
      branches: 85,
    },
  },
  moduleNameMapper: {},
  modulePathIgnorePatterns: ['<rootDir>/dist/', '<rootDir>/example/'],
};
