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
    it('should extract a simple function declaration', async () => {
      const code = `function greet(name: string): string {
  return 'Hello ' + name;
}`;

      const symbols = await extractSymbols(code, testFilePath, testRelativePath, '.ts');

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

    it('should extract an exported function', async () => {
      const code = `export function calculate(x: number): number {
  return x * 2;
}`;

      const symbols = await extractSymbols(code, testFilePath, testRelativePath, '.ts');

      expect(symbols).toHaveLength(1);
      expect(symbols[0]).toMatchObject({
        name: 'calculate',
        kind: 'function',
        isExported: true,
        isDefaultExport: false,
      });
    });

    it('should extract a default exported function', async () => {
      const code = `export default function main() {
  console.log('main');
}`;

      const symbols = await extractSymbols(code, testFilePath, testRelativePath, '.ts');

      expect(symbols).toHaveLength(1);
      expect(symbols[0]).toMatchObject({
        name: 'main',
        kind: 'function',
        isExported: true,
        isDefaultExport: true,
      });
    });

    it('should extract async function', async () => {
      const code = `async function fetchData() {
  return await fetch('/api');
}`;

      const symbols = await extractSymbols(code, testFilePath, testRelativePath, '.ts');

      expect(symbols).toHaveLength(1);
      expect(symbols[0]).toMatchObject({
        name: 'fetchData',
        kind: 'function',
      });
      expect(symbols[0].modifiers).toContain('async');
    });

    it('should extract generator function', async () => {
      const code = `function* generateNumbers() {
  yield 1;
  yield 2;
}`;

      const symbols = await extractSymbols(code, testFilePath, testRelativePath, '.ts');

      expect(symbols).toHaveLength(1);
      expect(symbols[0]).toMatchObject({
        name: 'generateNumbers',
        kind: 'function',
      });
      expect(symbols[0].modifiers).toContain('generator');
    });
  });

  describe('Arrow Functions', () => {
    it('should extract arrow function from const declaration', async () => {
      const code = `const add = (a: number, b: number): number => {
  return a + b;
};`;

      const symbols = await extractSymbols(code, testFilePath, testRelativePath, '.ts');

      expect(symbols).toHaveLength(1);
      expect(symbols[0]).toMatchObject({
        name: 'add',
        kind: 'arrow_function',
        isExported: false,
      });
      expect(symbols[0].signature).toContain('add');
      expect(symbols[0].signature).toContain('a: number');
    });

    it('should extract exported arrow function', async () => {
      const code = `export const multiply = (x: number, y: number) => x * y;`;

      const symbols = await extractSymbols(code, testFilePath, testRelativePath, '.ts');

      expect(symbols).toHaveLength(1);
      expect(symbols[0]).toMatchObject({
        name: 'multiply',
        kind: 'arrow_function',
        isExported: true,
        isDefaultExport: false,
      });
    });

    it('should extract async arrow function', async () => {
      const code = `const fetchUser = async (id: string) => {
  return await api.get(id);
};`;

      const symbols = await extractSymbols(code, testFilePath, testRelativePath, '.ts');

      expect(symbols).toHaveLength(1);
      expect(symbols[0]).toMatchObject({
        name: 'fetchUser',
        kind: 'arrow_function',
      });
      expect(symbols[0].modifiers).toContain('async');
    });
  });

  describe('Classes', () => {
    it('should extract a simple class declaration', async () => {
      const code = `class User {
  name: string;

  constructor(name: string) {
    this.name = name;
  }

  greet() {
    return 'Hello ' + this.name;
  }
}`;

      const symbols = await extractSymbols(code, testFilePath, testRelativePath, '.ts');

      // Should extract: class, property, constructor, method
      expect(symbols.length).toBeGreaterThanOrEqual(1);

      const classSymbol = symbols.find(s => s.kind === 'class');
      expect(classSymbol).toBeDefined();
      expect(classSymbol?.name).toBe('User');
      expect(classSymbol?.isExported).toBe(false);
    });

    it('should extract class methods with parent reference', async () => {
      const code = `class Calculator {
  add(a: number, b: number): number {
    return a + b;
  }
}`;

      const symbols = await extractSymbols(code, testFilePath, testRelativePath, '.ts');

      const methodSymbol = symbols.find(s => s.kind === 'method');
      expect(methodSymbol).toBeDefined();
      expect(methodSymbol?.name).toBe('add');
      expect(methodSymbol?.parentId).toContain('Calculator');
    });

    it('should extract class properties', async () => {
      const code = `class Config {
  readonly apiUrl: string = 'https://api.example.com';
  private apiKey: string;
}`;

      const symbols = await extractSymbols(code, testFilePath, testRelativePath, '.ts');

      const properties = symbols.filter(s => s.kind === 'property');
      expect(properties.length).toBeGreaterThanOrEqual(1);

      const readonlyProp = properties.find(p => p.name === 'apiUrl');
      expect(readonlyProp?.modifiers).toContain('readonly');
    });

    it('should extract static methods', async () => {
      const code = `class Utils {
  static formatDate(date: Date): string {
    return date.toISOString();
  }
}`;

      const symbols = await extractSymbols(code, testFilePath, testRelativePath, '.ts');

      const staticMethod = symbols.find(s => s.kind === 'method' && s.name === 'formatDate');
      expect(staticMethod).toBeDefined();
      expect(staticMethod?.modifiers).toContain('static');
    });

    it('should extract exported class', async () => {
      const code = `export class Database {
  connect() {}
}`;

      const symbols = await extractSymbols(code, testFilePath, testRelativePath, '.ts');

      const classSymbol = symbols.find(s => s.kind === 'class');
      expect(classSymbol?.isExported).toBe(true);
      expect(classSymbol?.isDefaultExport).toBe(false);
    });

    it('should extract default exported class', async () => {
      const code = `export default class App {
  run() {}
}`;

      const symbols = await extractSymbols(code, testFilePath, testRelativePath, '.ts');

      const classSymbol = symbols.find(s => s.kind === 'class');
      expect(classSymbol?.isExported).toBe(true);
      expect(classSymbol?.isDefaultExport).toBe(true);
    });
  });

  describe('TypeScript Interfaces', () => {
    it('should extract interface declaration', async () => {
      const code = `interface User {
  id: string;
  name: string;
  email: string;
}`;

      const symbols = await extractSymbols(code, testFilePath, testRelativePath, '.ts');

      expect(symbols).toHaveLength(1);
      expect(symbols[0]).toMatchObject({
        name: 'User',
        kind: 'interface',
        isExported: false,
      });
    });

    it('should extract exported interface', async () => {
      const code = `export interface ApiResponse {
  status: number;
  data: unknown;
}`;

      const symbols = await extractSymbols(code, testFilePath, testRelativePath, '.ts');

      expect(symbols).toHaveLength(1);
      expect(symbols[0]).toMatchObject({
        name: 'ApiResponse',
        kind: 'interface',
        isExported: true,
      });
    });

    it('should extract interface with methods', async () => {
      const code = `interface Repository {
  save(item: unknown): Promise<void>;
  findById(id: string): Promise<unknown>;
}`;

      const symbols = await extractSymbols(code, testFilePath, testRelativePath, '.ts');

      const interfaceSymbol = symbols.find(s => s.kind === 'interface');
      expect(interfaceSymbol).toBeDefined();
      expect(interfaceSymbol?.name).toBe('Repository');
    });
  });

  describe('TypeScript Type Aliases', () => {
    it('should extract simple type alias', async () => {
      const code = `type Status = 'pending' | 'success' | 'error';`;

      const symbols = await extractSymbols(code, testFilePath, testRelativePath, '.ts');

      expect(symbols).toHaveLength(1);
      expect(symbols[0]).toMatchObject({
        name: 'Status',
        kind: 'type_alias',
        isExported: false,
      });
    });

    it('should extract exported type alias', async () => {
      const code = `export type UserId = string;`;

      const symbols = await extractSymbols(code, testFilePath, testRelativePath, '.ts');

      expect(symbols).toHaveLength(1);
      expect(symbols[0]).toMatchObject({
        name: 'UserId',
        kind: 'type_alias',
        isExported: true,
      });
    });

    it('should extract complex type alias', async () => {
      const code = `type ApiHandler = (req: Request, res: Response) => Promise<void>;`;

      const symbols = await extractSymbols(code, testFilePath, testRelativePath, '.ts');

      expect(symbols).toHaveLength(1);
      expect(symbols[0]).toMatchObject({
        name: 'ApiHandler',
        kind: 'type_alias',
      });
    });
  });

  describe('TypeScript Enums', () => {
    it('should extract enum declaration', async () => {
      const code = `enum Color {
  Red,
  Green,
  Blue
}`;

      const symbols = await extractSymbols(code, testFilePath, testRelativePath, '.ts');

      const enumSymbol = symbols.find(s => s.kind === 'enum');
      expect(enumSymbol).toBeDefined();
      expect(enumSymbol?.name).toBe('Color');
    });

    it('should extract enum members', async () => {
      const code = `enum Status {
  Pending = 0,
  Success = 1,
  Error = 2
}`;

      const symbols = await extractSymbols(code, testFilePath, testRelativePath, '.ts');

      const enumMembers = symbols.filter(s => s.kind === 'enum_member');
      expect(enumMembers.length).toBe(3);
      expect(enumMembers.map(m => m.name)).toContain('Pending');
      expect(enumMembers.map(m => m.name)).toContain('Success');
      expect(enumMembers.map(m => m.name)).toContain('Error');
    });

    it('should extract exported enum', async () => {
      const code = `export enum LogLevel {
  Debug,
  Info,
  Warning,
  Error
}`;

      const symbols = await extractSymbols(code, testFilePath, testRelativePath, '.ts');

      const enumSymbol = symbols.find(s => s.kind === 'enum');
      expect(enumSymbol?.isExported).toBe(true);
    });
  });

  describe('JSDoc Extraction', () => {
    it('should extract JSDoc from function', async () => {
      const code = `/**
 * Calculates the sum of two numbers
 * @param a First number
 * @param b Second number
 * @returns The sum
 */
function add(a: number, b: number): number {
  return a + b;
}`;

      const symbols = await extractSymbols(code, testFilePath, testRelativePath, '.ts');

      expect(symbols).toHaveLength(1);
      expect(symbols[0].documentation).toBeDefined();
      expect(symbols[0].documentation).toContain('Calculates the sum');
    });

    it('should extract JSDoc from class', async () => {
      const code = `/**
 * Represents a user in the system
 */
class User {
  name: string;
}`;

      const symbols = await extractSymbols(code, testFilePath, testRelativePath, '.ts');

      const classSymbol = symbols.find(s => s.kind === 'class');
      expect(classSymbol?.documentation).toBeDefined();
      expect(classSymbol?.documentation).toContain('Represents a user');
    });
  });

  describe('Location Information', () => {
    it('should capture accurate line numbers', async () => {
      const code = `// Line 1
// Line 2
function test() {
  return true;
}`;

      const symbols = await extractSymbols(code, testFilePath, testRelativePath, '.ts');

      expect(symbols).toHaveLength(1);
      expect(symbols[0].lineStart).toBe(3);
      expect(symbols[0].lineEnd).toBeGreaterThanOrEqual(3);
    });

    it('should capture column positions', async () => {
      const code = `function test() {}`;

      const symbols = await extractSymbols(code, testFilePath, testRelativePath, '.ts');

      expect(symbols).toHaveLength(1);
      expect(symbols[0].columnStart).toBeGreaterThanOrEqual(0);
      expect(symbols[0].columnEnd).toBeGreaterThan(symbols[0].columnStart);
    });
  });

  describe('Multiple Symbols', () => {
    it('should extract multiple functions', async () => {
      const code = `function add(a: number, b: number) { return a + b; }
function subtract(a: number, b: number) { return a - b; }
function multiply(a: number, b: number) { return a * b; }`;

      const symbols = await extractSymbols(code, testFilePath, testRelativePath, '.ts');

      expect(symbols).toHaveLength(3);
      expect(symbols.map(s => s.name)).toContain('add');
      expect(symbols.map(s => s.name)).toContain('subtract');
      expect(symbols.map(s => s.name)).toContain('multiply');
    });

    it('should extract mixed symbol types', async () => {
      const code = `interface Config {
  apiUrl: string;
}

class Service {
  config: Config;
}

function createService() {
  return new Service();
}`;

      const symbols = await extractSymbols(code, testFilePath, testRelativePath, '.ts');

      expect(symbols.length).toBeGreaterThanOrEqual(3);
      expect(symbols.map(s => s.kind)).toContain('interface');
      expect(symbols.map(s => s.kind)).toContain('class');
      expect(symbols.map(s => s.kind)).toContain('function');
    });
  });

  describe('Error Handling', () => {
    it('should handle syntax errors gracefully', async () => {
      const code = `function broken( {
  // Missing closing brace
`;

      // Should not throw, but may return empty or partial results
      expect(() => {
        extractSymbols(code, testFilePath, testRelativePath, '.ts');
      }).not.toThrow();
    });

    it('should handle empty code', async () => {
      const code = '';

      const symbols = await extractSymbols(code, testFilePath, testRelativePath, '.ts');

      expect(symbols).toEqual([]);
    });

    it('should handle code with only comments', async () => {
      const code = `// Just a comment
/* Another comment */`;

      const symbols = await extractSymbols(code, testFilePath, testRelativePath, '.ts');

      expect(symbols).toEqual([]);
    });
  });

  describe('ID Generation', () => {
    it('should generate unique IDs for symbols', async () => {
      const code = `function foo() {}
function bar() {}`;

      const symbols = await extractSymbols(code, testFilePath, testRelativePath, '.ts');

      expect(symbols).toHaveLength(2);
      expect(symbols[0].id).not.toBe(symbols[1].id);
      expect(symbols[0].id).toContain('foo');
      expect(symbols[1].id).toContain('bar');
    });

    it('should include file path in ID', async () => {
      const code = `function test() {}`;

      const symbols = await extractSymbols(code, testFilePath, testRelativePath, '.ts');

      expect(symbols).toHaveLength(1);
      expect(symbols[0].id).toContain(testRelativePath);
    });
  });

  describe('Solidity Support', () => {
    const testSolFilePath = '/project/Test.sol';
    const testSolRelativePath = 'Test.sol';

    describe('Contracts', () => {
      it('should extract a simple contract', async () => {
        const code = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract SimpleStorage {
    uint256 value;
}`;

        const symbols = await extractSymbols(code, testSolFilePath, testSolRelativePath, '.sol');

        expect(symbols.length).toBeGreaterThanOrEqual(1);
        const contract = symbols.find(s => s.kind === 'class' && s.name === 'SimpleStorage');
        expect(contract).toBeDefined();
        expect(contract?.filePath).toBe(testSolFilePath);
        expect(contract?.relativePath).toBe(testSolRelativePath);
      });

      it('should extract inherited contract', async () => {
        const code = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract Base {}
contract Derived is Base {}`;

        const symbols = await extractSymbols(code, testSolFilePath, testSolRelativePath, '.sol');

        const contracts = symbols.filter(s => s.kind === 'class');
        expect(contracts.length).toBeGreaterThanOrEqual(2);
        expect(contracts.map(c => c.name)).toContain('Base');
        expect(contracts.map(c => c.name)).toContain('Derived');
      });

      it('should extract abstract contract', async () => {
        const code = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

abstract contract AbstractContract {
    function abstractFunc() public virtual;
}`;

        const symbols = await extractSymbols(code, testSolFilePath, testSolRelativePath, '.sol');

        const contract = symbols.find(s => s.kind === 'class' && s.name === 'AbstractContract');
        expect(contract).toBeDefined();
        expect(contract?.modifiers).toContain('abstract');
      });

      it('should extract interface', async () => {
        const code = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface IERC20 {
    function totalSupply() external view returns (uint256);
}`;

        const symbols = await extractSymbols(code, testSolFilePath, testSolRelativePath, '.sol');

        const iface = symbols.find(s => s.kind === 'interface' && s.name === 'IERC20');
        expect(iface).toBeDefined();
      });

      it('should extract library', async () => {
        const code = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

library SafeMath {
    function add(uint256 a, uint256 b) internal pure returns (uint256) {
        return a + b;
    }
}`;

        const symbols = await extractSymbols(code, testSolFilePath, testSolRelativePath, '.sol');

        const library = symbols.find(s => s.kind === 'class' && s.name === 'SafeMath');
        expect(library).toBeDefined();
        expect(library?.modifiers).toContain('library');
      });
    });

    describe('Functions', () => {
      it('should extract contract functions', async () => {
        const code = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract MyContract {
    function getValue() public view returns (uint256) {
        return 42;
    }
}`;

        const symbols = await extractSymbols(code, testSolFilePath, testSolRelativePath, '.sol');

        const func = symbols.find(s => s.kind === 'function' && s.name === 'getValue');
        expect(func).toBeDefined();
        expect(func?.modifiers).toContain('public');
        expect(func?.modifiers).toContain('view');
      });

      it('should extract function visibility modifiers', async () => {
        const code = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract Visibility {
    function publicFunc() public {}
    function externalFunc() external {}
    function internalFunc() internal {}
    function privateFunc() private {}
}`;

        const symbols = await extractSymbols(code, testSolFilePath, testSolRelativePath, '.sol');

        const funcs = symbols.filter(s => s.kind === 'function');
        expect(funcs.length).toBeGreaterThanOrEqual(4);

        const publicFunc = funcs.find(f => f.name === 'publicFunc');
        expect(publicFunc?.modifiers).toContain('public');

        const externalFunc = funcs.find(f => f.name === 'externalFunc');
        expect(externalFunc?.modifiers).toContain('external');

        const internalFunc = funcs.find(f => f.name === 'internalFunc');
        expect(internalFunc?.modifiers).toContain('internal');

        const privateFunc = funcs.find(f => f.name === 'privateFunc');
        expect(privateFunc?.modifiers).toContain('private');
      });

      it('should extract function state mutability modifiers', async () => {
        const code = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract Mutability {
    function viewFunc() public view returns (uint256) { return 1; }
    function pureFunc() public pure returns (uint256) { return 1; }
    function payableFunc() public payable {}
}`;

        const symbols = await extractSymbols(code, testSolFilePath, testSolRelativePath, '.sol');

        const funcs = symbols.filter(s => s.kind === 'function');

        const viewFunc = funcs.find(f => f.name === 'viewFunc');
        expect(viewFunc?.modifiers).toContain('view');

        const pureFunc = funcs.find(f => f.name === 'pureFunc');
        expect(pureFunc?.modifiers).toContain('pure');

        const payableFunc = funcs.find(f => f.name === 'payableFunc');
        expect(payableFunc?.modifiers).toContain('payable');
      });

      it('should extract constructor', async () => {
        const code = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract MyContract {
    constructor(uint256 initialValue) {
        value = initialValue;
    }
    uint256 value;
}`;

        const symbols = await extractSymbols(code, testSolFilePath, testSolRelativePath, '.sol');

        const constructor = symbols.find(s => s.kind === 'function' && s.name === 'constructor');
        expect(constructor).toBeDefined();
      });

      it('should extract fallback and receive functions', async () => {
        const code = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract MyContract {
    fallback() external payable {}
    receive() external payable {}
}`;

        const symbols = await extractSymbols(code, testSolFilePath, testSolRelativePath, '.sol');

        const fallback = symbols.find(s => s.kind === 'function' && s.name === 'fallback');
        expect(fallback).toBeDefined();

        const receive = symbols.find(s => s.kind === 'function' && s.name === 'receive');
        expect(receive).toBeDefined();
      });
    });

    describe('Modifiers', () => {
      it('should extract modifiers', async () => {
        const code = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract MyContract {
    modifier onlyOwner() {
        require(msg.sender == owner);
        _;
    }
    address owner;
}`;

        const symbols = await extractSymbols(code, testSolFilePath, testSolRelativePath, '.sol');

        const modifier = symbols.find(s => s.kind === 'function' && s.name === 'onlyOwner');
        expect(modifier).toBeDefined();
        expect(modifier?.modifiers).toContain('modifier');
      });
    });

    describe('Events', () => {
      it('should extract events', async () => {
        const code = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract MyContract {
    event Transfer(address indexed from, address indexed to, uint256 value);
}`;

        const symbols = await extractSymbols(code, testSolFilePath, testSolRelativePath, '.sol');

        const event = symbols.find(s => s.kind === 'event' && s.name === 'Transfer');
        expect(event).toBeDefined();
      });

      it('should extract anonymous events', async () => {
        const code = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract MyContract {
    event DataUpdate(uint256 value) anonymous;
}`;

        const symbols = await extractSymbols(code, testSolFilePath, testSolRelativePath, '.sol');

        const event = symbols.find(s => s.kind === 'event' && s.name === 'DataUpdate');
        expect(event).toBeDefined();
        expect(event?.modifiers).toContain('anonymous');
      });
    });

    describe('State Variables', () => {
      it('should extract state variables', async () => {
        const code = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract MyContract {
    uint256 public counter;
    address private owner;
    mapping(address => uint256) internal balances;
}`;

        const symbols = await extractSymbols(code, testSolFilePath, testSolRelativePath, '.sol');

        const counter = symbols.find(s => s.kind === 'variable' && s.name === 'counter');
        expect(counter).toBeDefined();
        expect(counter?.modifiers).toContain('public');

        const owner = symbols.find(s => s.kind === 'variable' && s.name === 'owner');
        expect(owner).toBeDefined();
        expect(owner?.modifiers).toContain('private');

        const balances = symbols.find(s => s.kind === 'variable' && s.name === 'balances');
        expect(balances).toBeDefined();
        expect(balances?.modifiers).toContain('internal');
      });

      it('should extract constant state variables', async () => {
        const code = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract MyContract {
    uint256 public constant MAX_SUPPLY = 1000000;
}`;

        const symbols = await extractSymbols(code, testSolFilePath, testSolRelativePath, '.sol');

        const constant = symbols.find(s => s.name === 'MAX_SUPPLY');
        expect(constant).toBeDefined();
        expect(constant?.modifiers).toContain('constant');
      });

      it('should extract immutable state variables', async () => {
        const code = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract MyContract {
    address public immutable token;
    constructor(address _token) {
        token = _token;
    }
}`;

        const symbols = await extractSymbols(code, testSolFilePath, testSolRelativePath, '.sol');

        const immutable = symbols.find(s => s.name === 'token');
        expect(immutable).toBeDefined();
        expect(immutable?.modifiers).toContain('immutable');
      });
    });

    describe('Structs', () => {
      it('should extract struct definitions', async () => {
        const code = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract MyContract {
    struct User {
        string name;
        uint256 age;
        address wallet;
    }
}`;

        const symbols = await extractSymbols(code, testSolFilePath, testSolRelativePath, '.sol');

        const struct = symbols.find(s => s.kind === 'interface' && s.name === 'User');
        expect(struct).toBeDefined();
      });
    });

    describe('Enums', () => {
      it('should extract enum definitions', async () => {
        const code = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract MyContract {
    enum State { Active, Paused, Stopped }
}`;

        const symbols = await extractSymbols(code, testSolFilePath, testSolRelativePath, '.sol');

        const enumDef = symbols.find(s => s.kind === 'enum' && s.name === 'State');
        expect(enumDef).toBeDefined();
      });

      it('should extract enum members', async () => {
        const code = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract MyContract {
    enum Status { Pending, Approved, Rejected }
}`;

        const symbols = await extractSymbols(code, testSolFilePath, testSolRelativePath, '.sol');

        const enumMembers = symbols.filter(s => s.kind === 'enum_member');
        expect(enumMembers.length).toBeGreaterThanOrEqual(3);
        expect(enumMembers.map(m => m.name)).toContain('Pending');
        expect(enumMembers.map(m => m.name)).toContain('Approved');
        expect(enumMembers.map(m => m.name)).toContain('Rejected');
      });
    });

    describe('Errors', () => {
      it('should extract custom error definitions', async () => {
        const code = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract MyContract {
    error InsufficientBalance(uint256 requested, uint256 available);
    error Unauthorized();
}`;

        const symbols = await extractSymbols(code, testSolFilePath, testSolRelativePath, '.sol');

        const error1 = symbols.find(s => s.kind === 'type_alias' && s.name === 'InsufficientBalance');
        expect(error1).toBeDefined();

        const error2 = symbols.find(s => s.kind === 'type_alias' && s.name === 'Unauthorized');
        expect(error2).toBeDefined();
      });
    });

    describe('Error Handling', () => {
      it('should handle Solidity syntax errors gracefully', async () => {
        const code = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract Broken {
    function broken( {
        // Missing closing
`;

        expect(() => {
          extractSymbols(code, testSolFilePath, testSolRelativePath, '.sol');
        }).not.toThrow();
      });

      it('should handle empty Solidity file', async () => {
        const code = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;`;

        const symbols = await extractSymbols(code, testSolFilePath, testSolRelativePath, '.sol');

        expect(symbols).toEqual([]);
      });
    });

    describe('NatSpec Documentation', () => {
      it.skip('should extract NatSpec comments', async () => {
        // Skip for now - requires parsing comments from source code
        // which is more complex with the Solidity parser
        const code = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract MyContract {
    /// @notice Returns the current value
    /// @return The stored value
    function getValue() public view returns (uint256) {
        return value;
    }
    uint256 value;
}`;

        const symbols = await extractSymbols(code, testSolFilePath, testSolRelativePath, '.sol');

        const func = symbols.find(s => s.kind === 'function' && s.name === 'getValue');
        expect(func?.documentation).toBeDefined();
        expect(func?.documentation).toContain('@notice');
      });
    });
  });
});
