/**
 * Tests for symbol extraction from JavaScript/TypeScript code
 * Following TDD: Tests written BEFORE implementation
 */

import { describe, it, expect } from 'vitest';
import { extractSymbols } from './symbol-extractor.js';
import type { CodeSymbol } from './types.js';

describe('extractSymbols', () => {
  const testFilePath = '/project/test.ts';
  const testRelativePath = 'test.ts';

  describe('Function Declarations', () => {
    it('should extract a simple function declaration', () => {
      const code = `function greet(name: string): string {
  return 'Hello ' + name;
}`;

      const symbols = extractSymbols(code, testFilePath, testRelativePath, '.ts');

      expect(symbols).toHaveLength(1);
      expect(symbols[0]).toMatchObject({
        name: 'greet',
        kind: 'function',
        filePath: testFilePath,
        relativePath: testRelativePath,
        lineStart: 1,
        isExported: false,
        isDefaultExport: false,
      });
      expect(symbols[0].signature).toContain('greet');
      expect(symbols[0].signature).toContain('name: string');
      expect(symbols[0].signature).toContain('string');
    });

    it('should extract an exported function', () => {
      const code = `export function calculate(x: number): number {
  return x * 2;
}`;

      const symbols = extractSymbols(code, testFilePath, testRelativePath, '.ts');

      expect(symbols).toHaveLength(1);
      expect(symbols[0]).toMatchObject({
        name: 'calculate',
        kind: 'function',
        isExported: true,
        isDefaultExport: false,
      });
    });

    it('should extract a default exported function', () => {
      const code = `export default function main() {
  console.log('main');
}`;

      const symbols = extractSymbols(code, testFilePath, testRelativePath, '.ts');

      expect(symbols).toHaveLength(1);
      expect(symbols[0]).toMatchObject({
        name: 'main',
        kind: 'function',
        isExported: true,
        isDefaultExport: true,
      });
    });

    it('should extract async function', () => {
      const code = `async function fetchData() {
  return await fetch('/api');
}`;

      const symbols = extractSymbols(code, testFilePath, testRelativePath, '.ts');

      expect(symbols).toHaveLength(1);
      expect(symbols[0]).toMatchObject({
        name: 'fetchData',
        kind: 'function',
      });
      expect(symbols[0].modifiers).toContain('async');
    });

    it('should extract generator function', () => {
      const code = `function* generateNumbers() {
  yield 1;
  yield 2;
}`;

      const symbols = extractSymbols(code, testFilePath, testRelativePath, '.ts');

      expect(symbols).toHaveLength(1);
      expect(symbols[0]).toMatchObject({
        name: 'generateNumbers',
        kind: 'function',
      });
      expect(symbols[0].modifiers).toContain('generator');
    });
  });

  describe('Arrow Functions', () => {
    it('should extract arrow function from const declaration', () => {
      const code = `const add = (a: number, b: number): number => {
  return a + b;
};`;

      const symbols = extractSymbols(code, testFilePath, testRelativePath, '.ts');

      expect(symbols).toHaveLength(1);
      expect(symbols[0]).toMatchObject({
        name: 'add',
        kind: 'arrow_function',
        isExported: false,
      });
      expect(symbols[0].signature).toContain('add');
      expect(symbols[0].signature).toContain('a: number');
    });

    it('should extract exported arrow function', () => {
      const code = `export const multiply = (x: number, y: number) => x * y;`;

      const symbols = extractSymbols(code, testFilePath, testRelativePath, '.ts');

      expect(symbols).toHaveLength(1);
      expect(symbols[0]).toMatchObject({
        name: 'multiply',
        kind: 'arrow_function',
        isExported: true,
        isDefaultExport: false,
      });
    });

    it('should extract async arrow function', () => {
      const code = `const fetchUser = async (id: string) => {
  return await api.get(id);
};`;

      const symbols = extractSymbols(code, testFilePath, testRelativePath, '.ts');

      expect(symbols).toHaveLength(1);
      expect(symbols[0]).toMatchObject({
        name: 'fetchUser',
        kind: 'arrow_function',
      });
      expect(symbols[0].modifiers).toContain('async');
    });
  });

  describe('Classes', () => {
    it('should extract a simple class declaration', () => {
      const code = `class User {
  name: string;

  constructor(name: string) {
    this.name = name;
  }

  greet() {
    return 'Hello ' + this.name;
  }
}`;

      const symbols = extractSymbols(code, testFilePath, testRelativePath, '.ts');

      // Should extract: class, property, constructor, method
      expect(symbols.length).toBeGreaterThanOrEqual(1);

      const classSymbol = symbols.find(s => s.kind === 'class');
      expect(classSymbol).toBeDefined();
      expect(classSymbol?.name).toBe('User');
      expect(classSymbol?.isExported).toBe(false);
    });

    it('should extract class methods with parent reference', () => {
      const code = `class Calculator {
  add(a: number, b: number): number {
    return a + b;
  }
}`;

      const symbols = extractSymbols(code, testFilePath, testRelativePath, '.ts');

      const methodSymbol = symbols.find(s => s.kind === 'method');
      expect(methodSymbol).toBeDefined();
      expect(methodSymbol?.name).toBe('add');
      expect(methodSymbol?.parentId).toContain('Calculator');
    });

    it('should extract class properties', () => {
      const code = `class Config {
  readonly apiUrl: string = 'https://api.example.com';
  private apiKey: string;
}`;

      const symbols = extractSymbols(code, testFilePath, testRelativePath, '.ts');

      const properties = symbols.filter(s => s.kind === 'property');
      expect(properties.length).toBeGreaterThanOrEqual(1);

      const readonlyProp = properties.find(p => p.name === 'apiUrl');
      expect(readonlyProp?.modifiers).toContain('readonly');
    });

    it('should extract static methods', () => {
      const code = `class Utils {
  static formatDate(date: Date): string {
    return date.toISOString();
  }
}`;

      const symbols = extractSymbols(code, testFilePath, testRelativePath, '.ts');

      const staticMethod = symbols.find(s => s.kind === 'method' && s.name === 'formatDate');
      expect(staticMethod).toBeDefined();
      expect(staticMethod?.modifiers).toContain('static');
    });

    it('should extract exported class', () => {
      const code = `export class Database {
  connect() {}
}`;

      const symbols = extractSymbols(code, testFilePath, testRelativePath, '.ts');

      const classSymbol = symbols.find(s => s.kind === 'class');
      expect(classSymbol?.isExported).toBe(true);
      expect(classSymbol?.isDefaultExport).toBe(false);
    });

    it('should extract default exported class', () => {
      const code = `export default class App {
  run() {}
}`;

      const symbols = extractSymbols(code, testFilePath, testRelativePath, '.ts');

      const classSymbol = symbols.find(s => s.kind === 'class');
      expect(classSymbol?.isExported).toBe(true);
      expect(classSymbol?.isDefaultExport).toBe(true);
    });
  });

  describe('TypeScript Interfaces', () => {
    it('should extract interface declaration', () => {
      const code = `interface User {
  id: string;
  name: string;
  email: string;
}`;

      const symbols = extractSymbols(code, testFilePath, testRelativePath, '.ts');

      expect(symbols).toHaveLength(1);
      expect(symbols[0]).toMatchObject({
        name: 'User',
        kind: 'interface',
        isExported: false,
      });
    });

    it('should extract exported interface', () => {
      const code = `export interface ApiResponse {
  status: number;
  data: unknown;
}`;

      const symbols = extractSymbols(code, testFilePath, testRelativePath, '.ts');

      expect(symbols).toHaveLength(1);
      expect(symbols[0]).toMatchObject({
        name: 'ApiResponse',
        kind: 'interface',
        isExported: true,
      });
    });

    it('should extract interface with methods', () => {
      const code = `interface Repository {
  save(item: unknown): Promise<void>;
  findById(id: string): Promise<unknown>;
}`;

      const symbols = extractSymbols(code, testFilePath, testRelativePath, '.ts');

      const interfaceSymbol = symbols.find(s => s.kind === 'interface');
      expect(interfaceSymbol).toBeDefined();
      expect(interfaceSymbol?.name).toBe('Repository');
    });
  });

  describe('TypeScript Type Aliases', () => {
    it('should extract simple type alias', () => {
      const code = `type Status = 'pending' | 'success' | 'error';`;

      const symbols = extractSymbols(code, testFilePath, testRelativePath, '.ts');

      expect(symbols).toHaveLength(1);
      expect(symbols[0]).toMatchObject({
        name: 'Status',
        kind: 'type_alias',
        isExported: false,
      });
    });

    it('should extract exported type alias', () => {
      const code = `export type UserId = string;`;

      const symbols = extractSymbols(code, testFilePath, testRelativePath, '.ts');

      expect(symbols).toHaveLength(1);
      expect(symbols[0]).toMatchObject({
        name: 'UserId',
        kind: 'type_alias',
        isExported: true,
      });
    });

    it('should extract complex type alias', () => {
      const code = `type ApiHandler = (req: Request, res: Response) => Promise<void>;`;

      const symbols = extractSymbols(code, testFilePath, testRelativePath, '.ts');

      expect(symbols).toHaveLength(1);
      expect(symbols[0]).toMatchObject({
        name: 'ApiHandler',
        kind: 'type_alias',
      });
    });
  });

  describe('TypeScript Enums', () => {
    it('should extract enum declaration', () => {
      const code = `enum Color {
  Red,
  Green,
  Blue
}`;

      const symbols = extractSymbols(code, testFilePath, testRelativePath, '.ts');

      const enumSymbol = symbols.find(s => s.kind === 'enum');
      expect(enumSymbol).toBeDefined();
      expect(enumSymbol?.name).toBe('Color');
    });

    it('should extract enum members', () => {
      const code = `enum Status {
  Pending = 0,
  Success = 1,
  Error = 2
}`;

      const symbols = extractSymbols(code, testFilePath, testRelativePath, '.ts');

      const enumMembers = symbols.filter(s => s.kind === 'enum_member');
      expect(enumMembers.length).toBe(3);
      expect(enumMembers.map(m => m.name)).toContain('Pending');
      expect(enumMembers.map(m => m.name)).toContain('Success');
      expect(enumMembers.map(m => m.name)).toContain('Error');
    });

    it('should extract exported enum', () => {
      const code = `export enum LogLevel {
  Debug,
  Info,
  Warning,
  Error
}`;

      const symbols = extractSymbols(code, testFilePath, testRelativePath, '.ts');

      const enumSymbol = symbols.find(s => s.kind === 'enum');
      expect(enumSymbol?.isExported).toBe(true);
    });
  });

  describe('JSDoc Extraction', () => {
    it('should extract JSDoc from function', () => {
      const code = `/**
 * Calculates the sum of two numbers
 * @param a First number
 * @param b Second number
 * @returns The sum
 */
function add(a: number, b: number): number {
  return a + b;
}`;

      const symbols = extractSymbols(code, testFilePath, testRelativePath, '.ts');

      expect(symbols).toHaveLength(1);
      expect(symbols[0].documentation).toBeDefined();
      expect(symbols[0].documentation).toContain('Calculates the sum');
    });

    it('should extract JSDoc from class', () => {
      const code = `/**
 * Represents a user in the system
 */
class User {
  name: string;
}`;

      const symbols = extractSymbols(code, testFilePath, testRelativePath, '.ts');

      const classSymbol = symbols.find(s => s.kind === 'class');
      expect(classSymbol?.documentation).toBeDefined();
      expect(classSymbol?.documentation).toContain('Represents a user');
    });
  });

  describe('Location Information', () => {
    it('should capture accurate line numbers', () => {
      const code = `// Line 1
// Line 2
function test() {
  return true;
}`;

      const symbols = extractSymbols(code, testFilePath, testRelativePath, '.ts');

      expect(symbols).toHaveLength(1);
      expect(symbols[0].lineStart).toBe(3);
      expect(symbols[0].lineEnd).toBeGreaterThanOrEqual(3);
    });

    it('should capture column positions', () => {
      const code = `function test() {}`;

      const symbols = extractSymbols(code, testFilePath, testRelativePath, '.ts');

      expect(symbols).toHaveLength(1);
      expect(symbols[0].columnStart).toBeGreaterThanOrEqual(0);
      expect(symbols[0].columnEnd).toBeGreaterThan(symbols[0].columnStart);
    });
  });

  describe('Multiple Symbols', () => {
    it('should extract multiple functions', () => {
      const code = `function add(a: number, b: number) { return a + b; }
function subtract(a: number, b: number) { return a - b; }
function multiply(a: number, b: number) { return a * b; }`;

      const symbols = extractSymbols(code, testFilePath, testRelativePath, '.ts');

      expect(symbols).toHaveLength(3);
      expect(symbols.map(s => s.name)).toContain('add');
      expect(symbols.map(s => s.name)).toContain('subtract');
      expect(symbols.map(s => s.name)).toContain('multiply');
    });

    it('should extract mixed symbol types', () => {
      const code = `interface Config {
  apiUrl: string;
}

class Service {
  config: Config;
}

function createService() {
  return new Service();
}`;

      const symbols = extractSymbols(code, testFilePath, testRelativePath, '.ts');

      expect(symbols.length).toBeGreaterThanOrEqual(3);
      expect(symbols.map(s => s.kind)).toContain('interface');
      expect(symbols.map(s => s.kind)).toContain('class');
      expect(symbols.map(s => s.kind)).toContain('function');
    });
  });

  describe('Error Handling', () => {
    it('should handle syntax errors gracefully', () => {
      const code = `function broken( {
  // Missing closing brace
`;

      // Should not throw, but may return empty or partial results
      expect(() => {
        extractSymbols(code, testFilePath, testRelativePath, '.ts');
      }).not.toThrow();
    });

    it('should handle empty code', () => {
      const code = '';

      const symbols = extractSymbols(code, testFilePath, testRelativePath, '.ts');

      expect(symbols).toEqual([]);
    });

    it('should handle code with only comments', () => {
      const code = `// Just a comment
/* Another comment */`;

      const symbols = extractSymbols(code, testFilePath, testRelativePath, '.ts');

      expect(symbols).toEqual([]);
    });
  });

  describe('ID Generation', () => {
    it('should generate unique IDs for symbols', () => {
      const code = `function foo() {}
function bar() {}`;

      const symbols = extractSymbols(code, testFilePath, testRelativePath, '.ts');

      expect(symbols).toHaveLength(2);
      expect(symbols[0].id).not.toBe(symbols[1].id);
      expect(symbols[0].id).toContain('foo');
      expect(symbols[1].id).toContain('bar');
    });

    it('should include file path in ID', () => {
      const code = `function test() {}`;

      const symbols = extractSymbols(code, testFilePath, testRelativePath, '.ts');

      expect(symbols).toHaveLength(1);
      expect(symbols[0].id).toContain(testRelativePath);
    });
  });
});
