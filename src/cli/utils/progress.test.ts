import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createSpinner } from './progress.js';

describe('progress utility', () => {
  let originalIsTTY: boolean | undefined;
  let originalStdoutIsTTY: boolean;

  beforeEach(() => {
    originalIsTTY = process.stdout.isTTY;
    originalStdoutIsTTY = process.stdout.isTTY ?? false;
  });

  afterEach(() => {
    if (originalIsTTY === undefined) {
      delete (process.stdout as { isTTY?: boolean }).isTTY;
    } else {
      process.stdout.isTTY = originalIsTTY;
    }
    vi.clearAllMocks();
  });

  describe('createSpinner', () => {
    describe('in TTY mode', () => {
      beforeEach(() => {
        process.stdout.isTTY = true;
      });

      it('should create a spinner with initial text', () => {
        const spinner = createSpinner('Loading...');

        expect(spinner).toBeDefined();
        expect(spinner.start).toBeDefined();
        expect(spinner.stop).toBeDefined();
        expect(spinner.succeed).toBeDefined();
        expect(spinner.fail).toBeDefined();
        expect(spinner.update).toBeDefined();
      });

      it('should start and stop spinner', () => {
        const spinner = createSpinner('Processing');

        const startResult = spinner.start();
        expect(startResult).toBe(spinner);

        const stopResult = spinner.stop();
        expect(stopResult).toBe(spinner);
      });

      it('should update spinner text', () => {
        const spinner = createSpinner('Initial');

        spinner.start();
        const updateResult = spinner.update('Updated text');
        expect(updateResult).toBe(spinner);
        spinner.stop();
      });

      it('should succeed with message', () => {
        const spinner = createSpinner('Working');

        spinner.start();
        const result = spinner.succeed('Done!');
        expect(result).toBe(spinner);
      });

      it('should fail with message', () => {
        const spinner = createSpinner('Working');

        spinner.start();
        const result = spinner.fail('Failed!');
        expect(result).toBe(spinner);
      });

      it('should handle multiple sequential operations', () => {
        const spinner = createSpinner('Step 1');

        spinner.start();
        spinner.update('Step 2');
        spinner.update('Step 3');
        spinner.succeed('Complete');
      });
    });

    describe('in non-TTY mode', () => {
      beforeEach(() => {
        process.stdout.isTTY = false;
      });

      it('should create a fallback spinner', () => {
        const spinner = createSpinner('Loading...');

        expect(spinner).toBeDefined();
        expect(spinner.start).toBeDefined();
        expect(spinner.stop).toBeDefined();
      });

      it('should work without errors in non-TTY mode', () => {
        const spinner = createSpinner('Processing');

        expect(() => {
          spinner.start();
          spinner.update('Updated');
          spinner.succeed('Done');
        }).not.toThrow();
      });

      it('should handle fail in non-TTY mode', () => {
        const spinner = createSpinner('Processing');

        expect(() => {
          spinner.start();
          spinner.fail('Error');
        }).not.toThrow();
      });
    });

    describe('error handling', () => {
      beforeEach(() => {
        process.stdout.isTTY = true;
      });

      it('should stop spinner on error before throwing', () => {
        const spinner = createSpinner('Working');

        spinner.start();

        expect(() => {
          try {
            throw new Error('Something failed');
          } catch (err) {
            spinner.fail('Operation failed');
            throw err;
          }
        }).toThrow('Something failed');
      });

      it('should allow stopping an already stopped spinner', () => {
        const spinner = createSpinner('Test');

        spinner.start();
        spinner.stop();

        expect(() => {
          spinner.stop();
        }).not.toThrow();
      });
    });
  });
});
