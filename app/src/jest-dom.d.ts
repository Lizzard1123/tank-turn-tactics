// Augment vitest's Assertion with jest-dom matchers directly from the
// standalone matchers types (jest-dom's shipped vitest augmentation uses
// an import style this tsconfig rejects).
import type { TestingLibraryMatchers } from '@testing-library/jest-dom/matchers';

declare module 'vitest' {
  interface Assertion<T = any> extends TestingLibraryMatchers<any, T> {}
  interface AsymmetricMatchersContaining extends TestingLibraryMatchers<any, any> {}
}
