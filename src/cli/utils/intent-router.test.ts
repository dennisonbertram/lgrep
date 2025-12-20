import { describe, it, expect } from 'vitest';
import { parseIntent } from './intent-router.js';

describe('Intent router heuristics', () => {
  it('prefers callers when asked "what calls X"', () => {
    const action = parseIntent('what calls awardBadge');
    expect(action.command).toBe('callers');
    expect(action.args[0]).toBe('awardBadge');
  });

  it('routes impact questions to impact', () => {
    const action = parseIntent('what happens if I change setScore');
    expect(action.command).toBe('impact');
    expect(action.args[0]).toBe('setScore');
  });

  it('detects rename patterns', () => {
    const action = parseIntent('rename oldName to newName');
    expect(action.command).toBe('rename');
    expect(action.args).toEqual(['oldName', 'newName']);
  });

  it('falls back to search for unknown prompts', () => {
    const action = parseIntent('explain the build workflow');
    expect(action.command).toBe('search');
  });
});
