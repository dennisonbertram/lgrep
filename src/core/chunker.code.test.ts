import { describe, it, expect } from 'vitest';
import { chunkCode } from './chunker.js';
import type { ChunkOptions } from './chunker.js';

describe('chunkCode - Code-aware chunking', () => {
  const defaultOptions: ChunkOptions = {
    maxTokens: 200,
    overlapTokens: 20,
  };

  describe('Simple function declarations', () => {
    it('should split at function boundaries', () => {
      const code = `function add(a, b) {
  return a + b;
}

function multiply(a, b) {
  return a * b;
}

function divide(a, b) {
  if (b === 0) throw new Error('Division by zero');
  return a / b;
}`;

      const chunks = chunkCode(code, '.js', defaultOptions);

      // Should create separate chunks for each function
      expect(chunks.length).toBeGreaterThan(0);

      // Each chunk should contain complete function(s)
      for (const chunk of chunks) {
        // Should not split mid-function (check for balanced braces)
        const openBraces = (chunk.content.match(/\{/g) || []).length;
        const closeBraces = (chunk.content.match(/\}/g) || []).length;
        expect(openBraces).toBe(closeBraces);
      }
    });

    it('should preserve function metadata', () => {
      const code = `function getUserById(id) {
  return database.query('SELECT * FROM users WHERE id = ?', [id]);
}`;

      const chunks = chunkCode(code, '.js', defaultOptions);

      expect(chunks).toHaveLength(1);
      expect(chunks[0]?.metadata).toBeDefined();
      expect(chunks[0]?.metadata?.type).toBe('function');
      expect(chunks[0]?.metadata?.name).toBe('getUserById');
    });
  });

  describe('Arrow functions and function expressions', () => {
    it('should handle arrow functions', () => {
      const code = `const add = (a, b) => {
  return a + b;
};

const multiply = (a, b) => a * b;

const complexFunc = (x) => {
  const result = x * 2;
  return result + 10;
};`;

      const chunks = chunkCode(code, '.js', defaultOptions);

      expect(chunks.length).toBeGreaterThan(0);

      // Should capture arrow function metadata
      const hasArrowFunctionMetadata = chunks.some(
        chunk => chunk.metadata?.type === 'function' || chunk.metadata?.type === 'arrow_function'
      );
      expect(hasArrowFunctionMetadata).toBe(true);
    });

    it('should handle function expressions', () => {
      const code = `const myFunc = function(x) {
  return x * 2;
};

const anotherFunc = function namedExpression(y) {
  return y + 5;
};`;

      const chunks = chunkCode(code, '.js', defaultOptions);

      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks[0]?.metadata?.type).toBeDefined();
    });
  });

  describe('ES6 classes with methods', () => {
    it('should chunk classes as single units when possible', () => {
      const code = `class Calculator {
  constructor() {
    this.result = 0;
  }

  add(x) {
    this.result += x;
    return this;
  }

  multiply(x) {
    this.result *= x;
    return this;
  }

  getResult() {
    return this.result;
  }
}`;

      const chunks = chunkCode(code, '.js', defaultOptions);

      // Class should be kept together if it fits
      expect(chunks).toHaveLength(1);
      expect(chunks[0]?.metadata?.type).toBe('class');
      expect(chunks[0]?.metadata?.name).toBe('Calculator');
      expect(chunks[0]?.content).toContain('class Calculator');
      expect(chunks[0]?.content).toContain('constructor');
    });

    it('should split large classes by methods', () => {
      const code = `class LargeClass {
  constructor() {
    this.data = [];
  }

  ${'  method() {\n    // Some logic here\n    return true;\n  }\n\n'.repeat(20)}
}`;

      const chunks = chunkCode(code, '.js', { maxTokens: 100, overlapTokens: 10 });

      // Should split into multiple chunks
      expect(chunks.length).toBeGreaterThan(1);

      // First chunk should identify as a class
      expect(chunks[0]?.metadata?.type).toBe('class');
      expect(chunks[0]?.metadata?.name).toBe('LargeClass');
    });
  });

  describe('Nested functions', () => {
    it('should handle nested function scopes', () => {
      const code = `function outer(x) {
  function inner(y) {
    return x + y;
  }

  return inner(10);
}`;

      const chunks = chunkCode(code, '.js', defaultOptions);

      expect(chunks).toHaveLength(1);
      expect(chunks[0]?.content).toContain('function outer');
      expect(chunks[0]?.content).toContain('function inner');
      expect(chunks[0]?.metadata?.name).toBe('outer');
    });

    it('should handle deeply nested structures', () => {
      const code = `function level1() {
  function level2() {
    function level3() {
      return 'deep';
    }
    return level3();
  }
  return level2();
}`;

      const chunks = chunkCode(code, '.js', defaultOptions);

      expect(chunks).toHaveLength(1);
      expect(chunks[0]?.metadata?.name).toBe('level1');
    });
  });

  describe('Import/export blocks', () => {
    it('should group imports together', () => {
      const code = `import React from 'react';
import { useState, useEffect } from 'react';
import styles from './styles.css';

function MyComponent() {
  return <div>Hello</div>;
}

export default MyComponent;`;

      const chunks = chunkCode(code, '.jsx', defaultOptions);

      // First chunk should contain all imports
      expect(chunks.length).toBeGreaterThan(0);
      const firstChunk = chunks[0]?.content || '';
      expect(firstChunk).toContain('import React');
      expect(firstChunk).toContain("import { useState, useEffect }");
    });

    it('should group exports appropriately', () => {
      const code = `export const API_KEY = 'xyz';
export const API_URL = 'https://api.example.com';

export function fetchData() {
  return fetch(API_URL);
}

export default class Client {
  constructor() {}
}`;

      const chunks = chunkCode(code, '.js', defaultOptions);

      expect(chunks.length).toBeGreaterThan(0);

      // Exports should be preserved with their declarations
      const hasExports = chunks.some(chunk =>
        chunk.content.includes('export')
      );
      expect(hasExports).toBe(true);
    });
  });

  describe('Syntax error handling', () => {
    it('should gracefully fallback to line-based chunking on syntax errors', () => {
      const invalidCode = `function broken {
  this is not valid JavaScript
  const x =
}`;

      // Should not throw, should fallback to regular chunking
      const chunks = chunkCode(invalidCode, '.js', defaultOptions);

      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks[0]?.metadata?.fallback).toBe(true);
    });

    it('should handle malformed JSX', () => {
      const invalidJSX = `function Component() {
  return <div>
    <span>Unclosed tag
  </div>
}`;

      const chunks = chunkCode(invalidJSX, '.jsx', defaultOptions);

      expect(chunks.length).toBeGreaterThan(0);
      // Should fallback gracefully
    });

    it('should handle files with invalid tokens', () => {
      const code = 'const x = @#$%^&*;';

      const chunks = chunkCode(code, '.js', defaultOptions);

      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks[0]?.metadata?.fallback).toBe(true);
    });
  });

  describe('Mixed functions and classes', () => {
    it('should handle files with both classes and functions', () => {
      const code = `class User {
  constructor(name) {
    this.name = name;
  }
}

function createUser(name) {
  return new User(name);
}

function validateUser(user) {
  return user.name && user.name.length > 0;
}`;

      const chunks = chunkCode(code, '.js', defaultOptions);

      expect(chunks.length).toBeGreaterThan(0);

      // Should have metadata for different types
      const types = chunks.map(c => c.metadata?.type).filter(Boolean);
      expect(types.length).toBeGreaterThan(0);
    });
  });

  describe('TypeScript-specific syntax', () => {
    it('should handle TypeScript interfaces', () => {
      const code = `interface User {
  id: number;
  name: string;
  email: string;
}

function getUser(id: number): User {
  return { id, name: 'Test', email: 'test@example.com' };
}`;

      const chunks = chunkCode(code, '.ts', defaultOptions);

      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks.some(c => c.content.includes('interface User'))).toBe(true);
    });

    it('should handle TypeScript types and generics', () => {
      const code = `type Result<T> = {
  success: boolean;
  data?: T;
  error?: string;
};

function createResult<T>(data: T): Result<T> {
  return { success: true, data };
}`;

      const chunks = chunkCode(code, '.ts', defaultOptions);

      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks.some(c => c.content.includes('type Result'))).toBe(true);
    });

    it('should handle enums', () => {
      const code = `enum Status {
  Pending = 'PENDING',
  Active = 'ACTIVE',
  Completed = 'COMPLETED'
}

function getStatus(id: number): Status {
  return Status.Pending;
}`;

      const chunks = chunkCode(code, '.ts', defaultOptions);

      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks.some(c => c.content.includes('enum Status'))).toBe(true);
    });

    it('should handle decorators', () => {
      const code = `@Controller('users')
class UserController {
  @Get(':id')
  getUser(@Param('id') id: string) {
    return { id };
  }
}`;

      const chunks = chunkCode(code, '.ts', defaultOptions);

      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks[0]?.content).toContain('@Controller');
      expect(chunks[0]?.metadata?.name).toBe('UserController');
    });
  });

  describe('File extension support', () => {
    it('should support .js files', () => {
      const code = 'function test() { return true; }';
      expect(() => chunkCode(code, '.js', defaultOptions)).not.toThrow();
    });

    it('should support .jsx files', () => {
      const code = 'function Component() { return <div />; }';
      expect(() => chunkCode(code, '.jsx', defaultOptions)).not.toThrow();
    });

    it('should support .ts files', () => {
      const code = 'function test(): boolean { return true; }';
      expect(() => chunkCode(code, '.ts', defaultOptions)).not.toThrow();
    });

    it('should support .tsx files', () => {
      const code = 'function Component(): JSX.Element { return <div />; }';
      expect(() => chunkCode(code, '.tsx', defaultOptions)).not.toThrow();
    });

    it('should fallback for unsupported extensions', () => {
      const code = 'some text here';
      const chunks = chunkCode(code, '.txt', defaultOptions);

      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks[0]?.metadata?.fallback).toBe(true);
    });
  });

  describe('Chunk metadata completeness', () => {
    it('should include all standard chunk fields', () => {
      const code = `function example() {
  return 'test';
}`;

      const chunks = chunkCode(code, '.js', defaultOptions);

      expect(chunks[0]).toMatchObject({
        content: expect.any(String),
        index: expect.any(Number),
        startChar: expect.any(Number),
        endChar: expect.any(Number),
        estimatedTokens: expect.any(Number),
      });
    });

    it('should include code-specific metadata', () => {
      const code = `class Example {
  method() {
    return 42;
  }
}`;

      const chunks = chunkCode(code, '.js', defaultOptions);

      expect(chunks[0]?.metadata).toBeDefined();
      expect(chunks[0]?.metadata?.type).toBeDefined();
      expect(chunks[0]?.metadata?.name).toBeDefined();
    });
  });
});
