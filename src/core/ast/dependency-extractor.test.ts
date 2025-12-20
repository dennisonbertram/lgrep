import { describe, it, expect } from 'vitest';
import { extractDependencies, type Dependency } from './dependency-extractor.js';

describe('extractDependencies', () => {
  describe('named imports', () => {
    it('should extract single named import', async () => {
      const code = `import { foo } from './module';`;
      const deps = await extractDependencies(code, '/test/file.ts');

      expect(deps).toHaveLength(1);
      expect(deps[0]).toMatchObject({
        type: 'import',
        source: './module',
        imported: [{ name: 'foo', alias: undefined }],
        isTypeOnly: false,
        isExternal: false,
      });
    });

    it('should extract multiple named imports', async () => {
      const code = `import { a, b, c } from './mod';`;
      const deps = await extractDependencies(code, '/test/file.ts');

      expect(deps).toHaveLength(1);
      expect(deps[0]?.imported).toEqual([
        { name: 'a', alias: undefined },
        { name: 'b', alias: undefined },
        { name: 'c', alias: undefined },
      ]);
    });

    it('should extract aliased imports', async () => {
      const code = `import { foo as bar, baz } from './mod';`;
      const deps = await extractDependencies(code, '/test/file.ts');

      expect(deps[0]?.imported).toEqual([
        { name: 'foo', alias: 'bar' },
        { name: 'baz', alias: undefined },
      ]);
    });
  });

  describe('default imports', () => {
    it('should extract default import', async () => {
      const code = `import React from 'react';`;
      const deps = await extractDependencies(code, '/test/file.ts');

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
    it('should extract namespace import', async () => {
      const code = `import * as ns from './utils';`;
      const deps = await extractDependencies(code, '/test/file.ts');

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
    it('should extract default and named imports together', async () => {
      const code = `import React, { useState, useEffect } from 'react';`;
      const deps = await extractDependencies(code, '/test/file.ts');

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
    it('should detect type-only import declaration', async () => {
      const code = `import type { User } from './types';`;
      const deps = await extractDependencies(code, '/test/file.ts');

      expect(deps[0]?.isTypeOnly).toBe(true);
    });

    it('should detect individual type imports', async () => {
      const code = `import { type User, createUser } from './api';`;
      const deps = await extractDependencies(code, '/test/file.ts');

      expect(deps[0]?.imported).toEqual([
        { name: 'User', alias: undefined, isType: true },
        { name: 'createUser', alias: undefined },
      ]);
    });
  });

  describe('dynamic imports', () => {
    it('should extract dynamic import', async () => {
      const code = `const mod = await import('./module');`;
      const deps = await extractDependencies(code, '/test/file.ts');

      expect(deps).toHaveLength(1);
      expect(deps[0]).toMatchObject({
        type: 'dynamic-import',
        source: './module',
        isExternal: false,
      });
    });

    it('should extract dynamic import in function', async () => {
      const code = `
        async function load() {
          const m = await import('./lazy');
        }
      `;
      const deps = await extractDependencies(code, '/test/file.ts');

      expect(deps).toHaveLength(1);
      expect(deps[0]?.type).toBe('dynamic-import');
    });
  });

  describe('require() calls', () => {
    it('should extract require call', async () => {
      const code = `const fs = require('fs');`;
      const deps = await extractDependencies(code, '/test/file.ts');

      expect(deps).toHaveLength(1);
      expect(deps[0]).toMatchObject({
        type: 'require',
        source: 'fs',
        isExternal: true,
      });
    });

    it('should extract relative require', async () => {
      const code = `const helper = require('./helper');`;
      const deps = await extractDependencies(code, '/test/file.ts');

      expect(deps[0]).toMatchObject({
        type: 'require',
        source: './helper',
        isExternal: false,
      });
    });
  });

  describe('exports', () => {
    it('should extract named exports', async () => {
      const code = `export { foo, bar };`;
      const deps = await extractDependencies(code, '/test/file.ts');

      expect(deps).toHaveLength(1);
      expect(deps[0]).toMatchObject({
        type: 'export',
        exported: [
          { name: 'foo', alias: undefined },
          { name: 'bar', alias: undefined },
        ],
      });
    });

    it('should extract default export', async () => {
      const code = `export default function main() {}`;
      const deps = await extractDependencies(code, '/test/file.ts');

      expect(deps).toHaveLength(1);
      expect(deps[0]).toMatchObject({
        type: 'export-default',
      });
    });

    it('should extract re-export', async () => {
      const code = `export { foo } from './other';`;
      const deps = await extractDependencies(code, '/test/file.ts');

      expect(deps).toHaveLength(1);
      expect(deps[0]).toMatchObject({
        type: 'export',
        source: './other',
        exported: [{ name: 'foo', alias: undefined }],
      });
    });

    it('should extract export all', async () => {
      const code = `export * from './module';`;
      const deps = await extractDependencies(code, '/test/file.ts');

      expect(deps).toHaveLength(1);
      expect(deps[0]).toMatchObject({
        type: 'export-all',
        source: './module',
      });
    });

    it('should extract export all as namespace', async () => {
      const code = `export * as utils from './utils';`;
      const deps = await extractDependencies(code, '/test/file.ts');

      expect(deps).toHaveLength(1);
      expect(deps[0]).toMatchObject({
        type: 'export-all',
        source: './utils',
        namespace: 'utils',
      });
    });
  });

  describe('external vs local detection', () => {
    it('should detect external package (no path prefix)', async () => {
      const code = `import React from 'react';`;
      const deps = await extractDependencies(code, '/test/file.ts');

      expect(deps[0]?.isExternal).toBe(true);
    });

    it('should detect local module (relative path)', async () => {
      const code = `import { helper } from './utils';`;
      const deps = await extractDependencies(code, '/test/file.ts');

      expect(deps[0]?.isExternal).toBe(false);
    });

    it('should detect local module (parent path)', async () => {
      const code = `import { config } from '../config';`;
      const deps = await extractDependencies(code, '/test/file.ts');

      expect(deps[0]?.isExternal).toBe(false);
    });

    it('should detect scoped package as external', async () => {
      const code = `import { Component } from '@org/package';`;
      const deps = await extractDependencies(code, '/test/file.ts');

      expect(deps[0]?.isExternal).toBe(true);
    });
  });

  describe('multiple dependencies', () => {
    it('should extract all dependencies in order', async () => {
      const code = `
        import React from 'react';
        import { useState } from 'react';
        import * as utils from './utils';
        const fs = require('fs');
        export { helper } from './helper';
      `;
      const deps = await extractDependencies(code, '/test/file.ts');

      expect(deps).toHaveLength(5);
      expect(deps[0]?.source).toBe('react');
      expect(deps[1]?.source).toBe('react');
      expect(deps[2]?.source).toBe('./utils');
      expect(deps[3]?.source).toBe('fs');
      expect(deps[4]?.source).toBe('./helper');
    });
  });

  describe('error handling', () => {
    it('should return empty array for invalid code', async () => {
      const code = `this is not valid javascript`;
      const deps = await extractDependencies(code, '/test/file.ts');

      expect(deps).toEqual([]);
    });

    it('should return empty array for empty code', async () => {
      const code = '';
      const deps = await extractDependencies(code, '/test/file.ts');

      expect(deps).toEqual([]);
    });
  });

  describe('Solidity Support', () => {
    const testSolFile = '/test/Contract.sol';

    describe('Import Statements', () => {
      it('should extract simple import', async () => {
        const code = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "./Token.sol";`;

        const deps = await extractDependencies(code, testSolFile);

        expect(deps.length).toBeGreaterThanOrEqual(1);
        const importDep = deps.find(d => d.source === './Token.sol');
        expect(importDep).toBeDefined();
        expect(importDep?.type).toBe('import');
        expect(importDep?.isExternal).toBe(false);
      });

      it('should extract named import', async () => {
        const code = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import { Token } from "./Token.sol";`;

        const deps = await extractDependencies(code, testSolFile);

        const importDep = deps.find(d => d.source === './Token.sol');
        expect(importDep).toBeDefined();
        expect(importDep?.imported).toBeDefined();
        expect(importDep?.imported?.length).toBeGreaterThanOrEqual(1);
      });

      it('should extract aliased import', async () => {
        const code = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import { IERC20 as ERC20Interface } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";`;

        const deps = await extractDependencies(code, testSolFile);

        const importDep = deps.find(d => d.source === '@openzeppelin/contracts/token/ERC20/IERC20.sol');
        expect(importDep).toBeDefined();
        expect(importDep?.isExternal).toBe(true);
      });

      it('should extract import with wildcard', async () => {
        const code = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import * as Utils from "./Utils.sol";`;

        const deps = await extractDependencies(code, testSolFile);

        const importDep = deps.find(d => d.source === './Utils.sol');
        expect(importDep).toBeDefined();
      });
    });

    describe('External vs Internal', () => {
      it('should mark relative imports as internal', async () => {
        const code = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "./Token.sol";
import "../interfaces/IToken.sol";`;

        const deps = await extractDependencies(code, testSolFile);

        deps.forEach(dep => {
          if (dep.source?.startsWith('.')) {
            expect(dep.isExternal).toBe(false);
          }
        });
      });

      it('should mark package imports as external', async () => {
        const code = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";`;

        const deps = await extractDependencies(code, testSolFile);

        const importDep = deps.find(d => d.source?.startsWith('@openzeppelin'));
        expect(importDep?.isExternal).toBe(true);
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
          extractDependencies(code, testSolFile);
        }).not.toThrow();
      });

      it('should handle empty Solidity file', async () => {
        const code = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;`;

        const deps = await extractDependencies(code, testSolFile);

        expect(deps).toEqual([]);
      });
    });
  });
});
