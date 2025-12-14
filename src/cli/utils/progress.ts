import ora, { type Ora } from 'ora';

/**
 * Spinner interface for progress indication.
 */
export interface Spinner {
  start(): Spinner;
  stop(): Spinner;
  succeed(message?: string): Spinner;
  fail(message?: string): Spinner;
  update(message: string): Spinner;
}

/**
 * Fallback spinner for non-TTY environments (CI, pipes, etc.)
 */
class FallbackSpinner implements Spinner {
  private text: string;

  constructor(text: string) {
    this.text = text;
  }

  start(): Spinner {
    console.log(this.text);
    return this;
  }

  stop(): Spinner {
    return this;
  }

  succeed(message?: string): Spinner {
    if (message) {
      console.log(`✓ ${message}`);
    }
    return this;
  }

  fail(message?: string): Spinner {
    if (message) {
      console.error(`✗ ${message}`);
    }
    return this;
  }

  update(message: string): Spinner {
    this.text = message;
    console.log(message);
    return this;
  }
}

/**
 * Wrapper for ora spinner to implement our Spinner interface.
 */
class OraSpinner implements Spinner {
  private spinner: Ora;

  constructor(spinner: Ora) {
    this.spinner = spinner;
  }

  start(): Spinner {
    this.spinner.start();
    return this;
  }

  stop(): Spinner {
    this.spinner.stop();
    return this;
  }

  succeed(message?: string): Spinner {
    this.spinner.succeed(message);
    return this;
  }

  fail(message?: string): Spinner {
    this.spinner.fail(message);
    return this;
  }

  update(message: string): Spinner {
    this.spinner.text = message;
    return this;
  }
}

/**
 * Create a spinner for progress indication.
 * Automatically detects TTY and uses fallback in non-TTY environments.
 *
 * @param text - Initial spinner text
 * @returns Spinner instance
 */
export function createSpinner(text: string): Spinner {
  // Check if we're in a TTY environment
  if (process.stdout.isTTY) {
    const oraSpinner = ora({
      text,
      color: 'cyan',
    });
    return new OraSpinner(oraSpinner);
  }

  // Fallback for non-TTY (CI, pipes, etc.)
  return new FallbackSpinner(text);
}
