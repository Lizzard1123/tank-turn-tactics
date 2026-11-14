import { describe, it, expect } from 'vitest';
import { EngineError } from '../src/errors';

describe('EngineError', () => {
  it('extends Error', () => {
    const err = new EngineError('test');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(EngineError);
  });

  it('has a message property', () => {
    const msg = 'something went wrong';
    const err = new EngineError(msg);
    expect(err.message).toBe(msg);
  });

  it('has a name property (defaults from Error)', () => {
    const err = new EngineError('test');
    // Error subclasses default to 'Error' name unless explicitly set
    expect(err.name).toBeDefined();
  });

  it('can be thrown and caught', () => {
    expect(() => { throw new EngineError('boom'); }).toThrow(EngineError);
    try {
      throw new EngineError('boom');
    } catch (e) {
      expect(e).toBeInstanceOf(EngineError);
      expect(e.message).toBe('boom');
    }
  });

  it('has a stack trace', () => {
    const err = new EngineError('test');
    expect(err.stack).toBeDefined();
    expect(typeof err.stack).toBe('string');
  });

  it('can include context in message', () => {
    const ctx = 'player=p1 action=attack';
    const err = new EngineError(`invalid state: ${ctx}`);
    expect(err.message).toContain(ctx);
  });

  it('can be created without arguments', () => {
    const err = new EngineError();
    expect(err.message).toBe('');
  });

  it('preserves cause property', () => {
    const cause = new Error('root');
    const err = new EngineError('wrapper', { cause });
    expect(err.cause).toBe(cause);
  });
});
