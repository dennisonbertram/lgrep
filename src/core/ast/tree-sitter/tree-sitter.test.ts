/**
 * Tests for tree-sitter multi-language code intelligence
 */

import { describe, it, expect } from 'vitest';
import { extractSymbolsTreeSitter } from './symbol-extractor.js';
import { extractCallsTreeSitter } from './call-extractor.js';
import { extractDependenciesTreeSitter } from './dependency-extractor.js';

describe('Tree-sitter Symbol Extraction', () => {
  describe('Go', () => {
    const testFilePath = '/project/main.go';
    const testRelativePath = 'main.go';
    const extension = '.go';

    it('should extract Go function declarations', async () => {
      const code = `package main

func greet(name string) string {
  return "Hello " + name
}`;

      const symbols = await extractSymbolsTreeSitter(code, testFilePath, testRelativePath, extension);

      expect(symbols.length).toBeGreaterThan(0);
      const greetFunc = symbols.find(s => s.name === 'greet');
      expect(greetFunc).toBeDefined();
      expect(greetFunc?.kind).toBe('function');
    });

    it('should extract Go method declarations', async () => {
      const code = `package main

type Person struct {
  name string
}

func (p *Person) Greet() string {
  return "Hello " + p.name
}`;

      const symbols = await extractSymbolsTreeSitter(code, testFilePath, testRelativePath, extension);

      const greetMethod = symbols.find(s => s.name === 'Greet');
      expect(greetMethod).toBeDefined();
      expect(greetMethod?.kind).toBe('method');
    });

    it('should extract Go type declarations', async () => {
      const code = `package main

type User struct {
  name string
  age int
}`;

      const symbols = await extractSymbolsTreeSitter(code, testFilePath, testRelativePath, extension);

      const userType = symbols.find(s => s.name === 'User');
      expect(userType).toBeDefined();
      expect(userType?.kind).toBe('type_alias');
    });
  });

  describe('Rust', () => {
    const testFilePath = '/project/main.rs';
    const testRelativePath = 'main.rs';
    const extension = '.rs';

    it('should extract Rust function declarations', async () => {
      const code = `fn greet(name: &str) -> String {
    format!("Hello {}", name)
}`;

      const symbols = await extractSymbolsTreeSitter(code, testFilePath, testRelativePath, extension);

      expect(symbols.length).toBeGreaterThan(0);
      const greetFunc = symbols.find(s => s.name === 'greet');
      expect(greetFunc).toBeDefined();
      expect(greetFunc?.kind).toBe('function');
    });

    it('should extract Rust struct declarations', async () => {
      const code = `struct Person {
    name: String,
    age: u32,
}`;

      const symbols = await extractSymbolsTreeSitter(code, testFilePath, testRelativePath, extension);

      const personStruct = symbols.find(s => s.name === 'Person');
      expect(personStruct).toBeDefined();
      expect(personStruct?.kind).toBe('class');
    });

    it('should extract Rust impl blocks', async () => {
      const code = `impl Person {
    fn new(name: String, age: u32) -> Person {
        Person { name, age }
    }
}`;

      const symbols = await extractSymbolsTreeSitter(code, testFilePath, testRelativePath, extension);

      const implBlock = symbols.find(s => s.name === 'Person');
      expect(implBlock).toBeDefined();
      expect(implBlock?.kind).toBe('class');
    });
  });

  describe('Python', () => {
    const testFilePath = '/project/main.py';
    const testRelativePath = 'main.py';
    const extension = '.py';

    it('should extract Python function definitions', async () => {
      const code = `def greet(name):
    return f"Hello {name}"`;

      const symbols = await extractSymbolsTreeSitter(code, testFilePath, testRelativePath, extension);

      expect(symbols.length).toBeGreaterThan(0);
      const greetFunc = symbols.find(s => s.name === 'greet');
      expect(greetFunc).toBeDefined();
      expect(greetFunc?.kind).toBe('function');
    });

    it('should extract Python class definitions', async () => {
      const code = `class Person:
    def __init__(self, name):
        self.name = name`;

      const symbols = await extractSymbolsTreeSitter(code, testFilePath, testRelativePath, extension);

      const personClass = symbols.find(s => s.name === 'Person');
      expect(personClass).toBeDefined();
      expect(personClass?.kind).toBe('class');
    });

    it('should extract decorated functions', async () => {
      const code = `@decorator
def process():
    pass`;

      const symbols = await extractSymbolsTreeSitter(code, testFilePath, testRelativePath, extension);

      const processFunc = symbols.find(s => s.name === 'process');
      expect(processFunc).toBeDefined();
      expect(processFunc?.kind).toBe('function');
    });
  });

  describe('Java', () => {
    const testFilePath = '/project/Main.java';
    const testRelativePath = 'Main.java';
    const extension = '.java';

    it('should extract Java class declarations', async () => {
      const code = `public class Person {
    private String name;

    public Person(String name) {
        this.name = name;
    }
}`;

      const symbols = await extractSymbolsTreeSitter(code, testFilePath, testRelativePath, extension);

      const personClass = symbols.find(s => s.name === 'Person');
      expect(personClass).toBeDefined();
      expect(personClass?.kind).toBe('class');
    });

    it('should extract Java method declarations', async () => {
      const code = `public class Test {
    public String greet(String name) {
        return "Hello " + name;
    }
}`;

      const symbols = await extractSymbolsTreeSitter(code, testFilePath, testRelativePath, extension);

      const greetMethod = symbols.find(s => s.name === 'greet');
      expect(greetMethod).toBeDefined();
      expect(greetMethod?.kind).toBe('method');
    });

    it('should extract Java interface declarations', async () => {
      const code = `public interface Greeting {
    String greet(String name);
}`;

      const symbols = await extractSymbolsTreeSitter(code, testFilePath, testRelativePath, extension);

      const greetingInterface = symbols.find(s => s.name === 'Greeting');
      expect(greetingInterface).toBeDefined();
      expect(greetingInterface?.kind).toBe('interface');
    });
  });
});

describe('Tree-sitter Call Extraction', () => {
  describe('Go', () => {
    const testFilePath = '/project/main.go';
    const extension = '.go';

    it('should extract Go function calls', async () => {
      const code = `package main

func main() {
  greet("World")
}`;

      const calls = await extractCallsTreeSitter(code, testFilePath, extension);

      expect(calls.length).toBeGreaterThan(0);
      const greetCall = calls.find(c => c.callee === 'greet');
      expect(greetCall).toBeDefined();
      expect(greetCall?.type).toBe('function');
    });

    it('should extract Go method calls', async () => {
      const code = `package main

func main() {
  p.Greet()
}`;

      const calls = await extractCallsTreeSitter(code, testFilePath, extension);

      const greetCall = calls.find(c => c.callee === 'Greet');
      expect(greetCall).toBeDefined();
    });
  });

  describe('Python', () => {
    const testFilePath = '/project/main.py';
    const extension = '.py';

    it('should extract Python function calls', async () => {
      const code = `def main():
    greet("World")`;

      const calls = await extractCallsTreeSitter(code, testFilePath, extension);

      expect(calls.length).toBeGreaterThan(0);
      const greetCall = calls.find(c => c.callee === 'greet');
      expect(greetCall).toBeDefined();
    });

    it('should extract Python method calls', async () => {
      const code = `def main():
    obj.method()`;

      const calls = await extractCallsTreeSitter(code, testFilePath, extension);

      const methodCall = calls.find(c => c.callee === 'method');
      expect(methodCall).toBeDefined();
    });
  });
});

describe('Tree-sitter Dependency Extraction', () => {
  describe('Go', () => {
    const testFilePath = '/project/main.go';
    const extension = '.go';

    it('should extract Go import statements', async () => {
      const code = `package main

import "fmt"
import "os"`;

      const deps = await extractDependenciesTreeSitter(code, testFilePath, extension);

      expect(deps.length).toBeGreaterThanOrEqual(2);
      const fmtImport = deps.find(d => d.source === 'fmt');
      expect(fmtImport).toBeDefined();
      expect(fmtImport?.type).toBe('import');
    });

    it('should extract Go import lists', async () => {
      const code = `package main

import (
  "fmt"
  "os"
  "strings"
)`;

      const deps = await extractDependenciesTreeSitter(code, testFilePath, extension);

      expect(deps.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('Python', () => {
    const testFilePath = '/project/main.py';
    const extension = '.py';

    it('should extract Python import statements', async () => {
      const code = `import os
import sys`;

      const deps = await extractDependenciesTreeSitter(code, testFilePath, extension);

      expect(deps.length).toBeGreaterThanOrEqual(2);
      const osImport = deps.find(d => d.source === 'os');
      expect(osImport).toBeDefined();
    });

    it('should extract Python from imports', async () => {
      const code = `from os import path
from sys import argv`;

      const deps = await extractDependenciesTreeSitter(code, testFilePath, extension);

      expect(deps.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Rust', () => {
    const testFilePath = '/project/main.rs';
    const extension = '.rs';

    it('should extract Rust use statements', async () => {
      const code = `use std::collections::HashMap;
use std::io::Read;`;

      const deps = await extractDependenciesTreeSitter(code, testFilePath, extension);

      expect(deps.length).toBeGreaterThanOrEqual(2);
    });
  });
});

describe('Error Handling', () => {
  it('should handle empty code gracefully', async () => {
    const symbols = await extractSymbolsTreeSitter('', '/test.go', 'test.go', '.go');
    expect(symbols).toEqual([]);
  });

  it('should handle invalid code gracefully', async () => {
    const code = 'this is not valid Go code @#$%';
    const symbols = await extractSymbolsTreeSitter(code, '/test.go', 'test.go', '.go');
    // Should not throw, may return empty or partial results
    expect(Array.isArray(symbols)).toBe(true);
  });

  it('should handle unsupported extension gracefully', async () => {
    const symbols = await extractSymbolsTreeSitter('test', '/test.txt', 'test.txt', '.txt');
    expect(symbols).toEqual([]);
  });
});
