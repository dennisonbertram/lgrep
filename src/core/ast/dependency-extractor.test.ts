import { describe, it, expect } from 'vitest';
import { extractDependencies, type Dependency } from './dependency-extractor.js';

describe('extractDependencies', () => {
  describe('named imports', () => {
    it('should extract single named import', () => {
      const code = `import { foo } from './module';`;
      const deps = extractDependencies(code, '/test/file.ts');

      expect(deps).toHaveLength(1);
      expect(deps[0]).toMatchObject({
        type: 'import',
        source: './module',
        imported: [{ name: 'foo', alias: undefined }],
        isTypeOnly: false,
        isExternal: false,
      });
    });

    it('should extract multiple named imports', () => {
      const code = `import { a, b, c } from './mod';`;
      const deps = extractDependencies(code, '/test/file.ts');

      expect(deps).toHaveLength(1);
      expect(deps[0]?.imported).toEqual([
        { name: 'a', alias: undefined },
        { name: 'b', alias: undefined },
        { name: 'c', alias: undefined },
      ]);
    });

    it('should extract aliased imports', () => {
      const code = `import { foo as bar, baz } from './mod';`;
      const deps = extractDependencies(code, '/test/file.ts');

      expect(deps[0]?.imported).toEqual([
        { name: 'foo', alias: 'bar' },
        { name: 'baz', alias: undefined },
      ]);
    });
  });

  describe('default imports', () => {
    it('should extract default import', () => {
      const code = `import React from 'react';`;
      const deps = extractDependencies(code, '/test/file.ts');

      expect(deps).toHaveLength(1);
      expect(deps[0]).toMatchObject({
        type: 'import',
        source: 'react',
        default: 'React',
        isExternal: true,
      });
    });
  });

  describe('namespace imports', () => {
    it('should extract namespace import', () => {
      const code = `import * as ns from './utils';`;
      const deps = extractDependencies(code, '/test/file.ts');

      expect(deps).toHaveLength(1);
      expect(deps[0]).toMatchObject({
        type: 'import',
        source: './utils',
        namespace: 'ns',
        isExternal: false,
      });
    });
  });

  describe('mixed imports', () => {
    it('should extract default and named imports together', () => {
      const code = `import React, { useState, useEffect } from 'react';`;
      const deps = extractDependencies(code, '/test/file.ts');

      expect(deps).toHaveLength(1);
      expect(deps[0]).toMatchObject({
        default: 'React',
        imported: [
          { name: 'useState', alias: undefined },
          { name: 'useEffect', alias: undefined },
        ],
      });
    });
  });

  describe('type-only imports', () => {
    it('should detect type-only import declaration', () => {
      const code = `import type { User } from './types';`;
      const deps = extractDependencies(code, '/test/file.ts');

      expect(deps[0]?.isTypeOnly).toBe(true);
    });

    it('should detect individual type imports', () => {
      const code = `import { type User, createUser } from './api';`;
      const deps = extractDependencies(code, '/test/file.ts');

      expect(deps[0]?.imported).toEqual([
        { name: 'User', alias: undefined, isType: true },
        { name: 'createUser', alias: undefined },
      ]);
    });
  });

  describe('dynamic imports', () => {
    it('should extract dynamic import', () => {
      const code = `const mod = await import('./module');`;
      const deps = extractDependencies(code, '/test/file.ts');

      expect(deps).toHaveLength(1);
      expect(deps[0]).toMatchObject({
        type: 'dynamic-import',
        source: './module',
        isExternal: false,
      });
    });

    it('should extract dynamic import in function', () => {
      const code = `
        async function load() {
          const m = await import('./lazy');
        }
      `;
      const deps = extractDependencies(code, '/test/file.ts');

      expect(deps).toHaveLength(1);
      expect(deps[0]?.type).toBe('dynamic-import');
    });
  });

  describe('require() calls', () => {
    it('should extract require call', () => {
      const code = `const fs = require('fs');`;
      const deps = extractDependencies(code, '/test/file.ts');

      expect(deps).toHaveLength(1);
      expect(deps[0]).toMatchObject({
        type: 'require',
        source: 'fs',
        isExternal: true,
      });
    });

    it('should extract relative require', () => {
      const code = `const helper = require('./helper');`;
      const deps = extractDependencies(code, '/test/file.ts');

      expect(deps[0]).toMatchObject({
        type: 'require',
        source: './helper',
        isExternal: false,
      });
    });
  });

  describe('exports', () => {
    it('should extract named exports', () => {
      const code = `export { foo, bar };`;
      const deps = extractDependencies(code, '/test/file.ts');

      expect(deps).toHaveLength(1);
      expect(deps[0]).toMatchObject({
        type: 'export',
        exported: [
          { name: 'foo', alias: undefined },
          { name: 'bar', alias: undefined },
        ],
      });
    });

    it('should extract default export', () => {
      const code = `export default function main() {}`;
      const deps = extractDependencies(code, '/test/file.ts');

      expect(deps).toHaveLength(1);
      expect(deps[0]).toMatchObject({
        type: 'export-default',
      });
    });

    it('should extract re-export', () => {
      const code = `export { foo } from './other';`;
      const deps = extractDependencies(code, '/test/file.ts');

      expect(deps).toHaveLength(1);
      expect(deps[0]).toMatchObject({
        type: 'export',
        source: './other',
        exported: [{ name: 'foo', alias: undefined }],
      });
    });

    it('should extract export all', () => {
      const code = `export * from './module';`;
      const deps = extractDependencies(code, '/test/file.ts');

      expect(deps).toHaveLength(1);
      expect(deps[0]).toMatchObject({
        type: 'export-all',
        source: './module',
      });
    });

    it('should extract export all as namespace', () => {
      const code = `export * as utils from './utils';`;
      const deps = extractDependencies(code, '/test/file.ts');

      expect(deps).toHaveLength(1);
      expect(deps[0]).toMatchObject({
        type: 'export-all',
        source: './utils',
        namespace: 'utils',
      });
    });
  });

  describe('external vs local detection', () => {
    it('should detect external package (no path prefix)', () => {
      const code = `import React from 'react';`;
      const deps = extractDependencies(code, '/test/file.ts');

      expect(deps[0]?.isExternal).toBe(true);
    });

    it('should detect local module (relative path)', () => {
      const code = `import { helper } from './utils';`;
      const deps = extractDependencies(code, '/test/file.ts');

      expect(deps[0]?.isExternal).toBe(false);
    });

    it('should detect local module (parent path)', () => {
      const code = `import { config } from '../config';`;
      const deps = extractDependencies(code, '/test/file.ts');

      expect(deps[0]?.isExternal).toBe(false);
    });

    it('should detect scoped package as external', () => {
      const code = `import { Component } from '@org/package';`;
      const deps = extractDependencies(code, '/test/file.ts');

      expect(deps[0]?.isExternal).toBe(true);
    });
  });

  describe('multiple dependencies', () => {
    it('should extract all dependencies in order', () => {
      const code = `
        import React from 'react';
        import { useState } from 'react';
        import * as utils from './utils';
        const fs = require('fs');
        export { helper } from './helper';
      `;
      const deps = extractDependencies(code, '/test/file.ts');

      expect(deps).toHaveLength(5);
      expect(deps[0]?.source).toBe('react');
      expect(deps[1]?.source).toBe('react');
      expect(deps[2]?.source).toBe('./utils');
      expect(deps[3]?.source).toBe('fs');
      expect(deps[4]?.source).toBe('./helper');
    });
  });

  describe('error handling', () => {
    it('should return empty array for invalid code', () => {
      const code = `this is not valid javascript`;
      const deps = extractDependencies(code, '/test/file.ts');

      expect(deps).toEqual([]);
    });

    it('should return empty array for empty code', () => {
      const code = '';
      const deps = extractDependencies(code, '/test/file.ts');

      expect(deps).toEqual([]);
    });
  });
});
