import { describe, it, expect } from 'vitest';
import { extractCalls, type FunctionCall } from './call-extractor.js';

describe('extractCalls', () => {
  describe('simple function calls', () => {
    it('should extract simple function call', () => {
      const code = `foo();`;
      const calls = extractCalls(code, '/test/file.ts');

      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({
        callee: 'foo',
        caller: null,
        type: 'function',
        argumentCount: 0,
      });
    });

    it('should extract function call with arguments', () => {
      const code = `console.log('hello', 'world');`;
      const calls = extractCalls(code, '/test/file.ts');

      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({
        callee: 'log',
        receiver: 'console',
        type: 'method',
        argumentCount: 2,
      });
    });
  });

  describe('method calls', () => {
    it('should extract method call', () => {
      const code = `obj.method();`;
      const calls = extractCalls(code, '/test/file.ts');

      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({
        callee: 'method',
        receiver: 'obj',
        type: 'method',
      });
    });

    it('should extract nested property method call', () => {
      const code = `obj.prop.method();`;
      const calls = extractCalls(code, '/test/file.ts');

      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({
        callee: 'method',
        receiver: 'obj.prop',
        type: 'method',
      });
    });
  });

  describe('chained calls', () => {
    it('should extract chained method calls', () => {
      const code = `obj.foo().bar().baz();`;
      const calls = extractCalls(code, '/test/file.ts');

      expect(calls).toHaveLength(3);
      // AST traversal order: innermost to outermost (baz, bar, foo)
      expect(calls[0]?.callee).toBe('baz');
      expect(calls[1]?.callee).toBe('bar');
      expect(calls[2]?.callee).toBe('foo');
    });

    it('should track receiver for chained calls', () => {
      const code = `data.filter(x => x > 0).map(x => x * 2);`;
      const calls = extractCalls(code, '/test/file.ts');

      expect(calls).toHaveLength(2);
      // AST traversal order: outermost first (map, then filter)
      expect(calls[0]).toMatchObject({
        callee: 'map',
        receiver: 'filter()', // Immediate receiver is the filter() call
      });
      expect(calls[1]).toMatchObject({
        callee: 'filter',
        receiver: 'data',
      });
    });
  });

  describe('nested calls', () => {
    it('should extract nested function calls', () => {
      const code = `outer(inner());`;
      const calls = extractCalls(code, '/test/file.ts');

      expect(calls).toHaveLength(2);
      expect(calls.map(c => c.callee)).toContain('outer');
      expect(calls.map(c => c.callee)).toContain('inner');
    });

    it('should extract deeply nested calls', () => {
      const code = `a(b(c(d())));`;
      const calls = extractCalls(code, '/test/file.ts');

      expect(calls).toHaveLength(4);
      // AST traversal order: outermost to innermost (a, b, c, d)
      expect(calls.map(c => c.callee)).toEqual(['a', 'b', 'c', 'd']);
    });
  });

  describe('calls inside functions', () => {
    it('should track caller context for function declaration', () => {
      const code = `
        function myFunc() {
          helper();
        }
      `;
      const calls = extractCalls(code, '/test/file.ts');

      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({
        callee: 'helper',
        caller: 'myFunc',
        type: 'function',
      });
    });

    it('should track caller context for arrow function', () => {
      const code = `
        const myFunc = () => {
          helper();
        };
      `;
      const calls = extractCalls(code, '/test/file.ts');

      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({
        callee: 'helper',
        caller: 'myFunc',
      });
    });

    it('should track nested function context', () => {
      const code = `
        function outer() {
          function inner() {
            deepCall();
          }
          inner();
        }
      `;
      const calls = extractCalls(code, '/test/file.ts');

      expect(calls).toHaveLength(2);
      expect(calls[0]).toMatchObject({
        callee: 'deepCall',
        caller: 'outer.inner',
      });
      expect(calls[1]).toMatchObject({
        callee: 'inner',
        caller: 'outer',
      });
    });
  });

  describe('calls inside classes', () => {
    it('should track caller context for class method', () => {
      const code = `
        class MyClass {
          myMethod() {
            helper();
          }
        }
      `;
      const calls = extractCalls(code, '/test/file.ts');

      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({
        callee: 'helper',
        caller: 'MyClass.myMethod',
      });
    });

    it('should track this calls', () => {
      const code = `
        class MyClass {
          method1() {
            this.method2();
          }
          method2() {}
        }
      `;
      const calls = extractCalls(code, '/test/file.ts');

      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({
        callee: 'method2',
        receiver: 'this',
        caller: 'MyClass.method1',
        type: 'method',
      });
    });
  });

  describe('IIFE calls', () => {
    it('should extract IIFE', () => {
      const code = `(function() { return 42; })();`;
      const calls = extractCalls(code, '/test/file.ts');

      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({
        callee: '(anonymous)',
        type: 'function',
      });
    });

    it('should extract arrow IIFE', () => {
      const code = `(() => { return 42; })();`;
      const calls = extractCalls(code, '/test/file.ts');

      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({
        callee: '(anonymous)',
        type: 'function',
      });
    });
  });

  describe('constructor calls', () => {
    it('should extract new expression', () => {
      const code = `const obj = new MyClass();`;
      const calls = extractCalls(code, '/test/file.ts');

      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({
        callee: 'MyClass',
        type: 'constructor',
        argumentCount: 0,
      });
    });

    it('should extract new expression with arguments', () => {
      const code = `const obj = new Date(2024, 0, 1);`;
      const calls = extractCalls(code, '/test/file.ts');

      expect(calls[0]).toMatchObject({
        callee: 'Date',
        type: 'constructor',
        argumentCount: 3,
      });
    });
  });

  describe('location tracking', () => {
    it('should track line and column numbers', () => {
      const code = `
        function test() {
          foo();
          bar();
        }
      `;
      const calls = extractCalls(code, '/test/file.ts');

      expect(calls).toHaveLength(2);
      expect(calls[0]?.line).toBe(3);
      expect(calls[1]?.line).toBe(4);
      expect(calls[0]?.column).toBeGreaterThanOrEqual(0);
    });
  });

  describe('error handling', () => {
    it('should return empty array for invalid code', () => {
      const code = `this is not valid javascript`;
      const calls = extractCalls(code, '/test/file.ts');

      expect(calls).toEqual([]);
    });

    it('should return empty array for empty code', () => {
      const code = '';
      const calls = extractCalls(code, '/test/file.ts');

      expect(calls).toEqual([]);
    });
  });

  describe('complex scenarios', () => {
    it('should handle callback functions', () => {
      const code = `
        function process(callback) {
          callback();
        }
        process(() => {
          helper();
        });
      `;
      const calls = extractCalls(code, '/test/file.ts');

      expect(calls.length).toBeGreaterThan(0);
      expect(calls.some(c => c.callee === 'process')).toBe(true);
      expect(calls.some(c => c.callee === 'callback')).toBe(true);
      expect(calls.some(c => c.callee === 'helper')).toBe(true);
    });

    it('should handle async/await calls', () => {
      const code = `
        async function fetchData() {
          const data = await fetch('/api');
          return data;
        }
      `;
      const calls = extractCalls(code, '/test/file.ts');

      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({
        callee: 'fetch',
        caller: 'fetchData',
      });
    });
  });
});
