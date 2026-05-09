import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: ['<rootDir>/test/**/*.spec.ts'],
  globalSetup: '<rootDir>/test/helpers/global-setup.ts',
  globalTeardown: '<rootDir>/test/helpers/global-teardown.ts',
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

export default config;