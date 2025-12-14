# Phase 1: Symbol Extraction - Example Output

## Example Code

```typescript
/**
 * User authentication service
 */
export class AuthService {
  private apiUrl: string;
  
  /**
   * Authenticates a user
   */
  async login(username: string, password: string): Promise<User> {
    return await this.authenticate(username, password);
  }
  
  private async authenticate(user: string, pass: string): Promise<User> {
    // Implementation
  }
}

export interface User {
  id: string;
  name: string;
  email: string;
}

export type AuthStatus = 'authenticated' | 'unauthenticated' | 'pending';

export enum UserRole {
  Admin = 'admin',
  User = 'user',
  Guest = 'guest'
}

export const createUser = async (data: UserData): Promise<User> => {
  // Implementation
};
```

## Extracted Symbols

The `extractSymbols()` function extracts:

### 1. Class: AuthService
- **Kind**: `class`
- **Exported**: `true`
- **Documentation**: "User authentication service"
- **Location**: Line 4, Column 0

### 2. Property: apiUrl
- **Kind**: `property`
- **Parent**: `AuthService`
- **Modifiers**: `["private"]`
- **Location**: Line 5, Column 2

### 3. Method: login
- **Kind**: `method`
- **Parent**: `AuthService`
- **Modifiers**: `["async"]`
- **Signature**: `async login (username: string, password: string): Promise<User>`
- **Documentation**: "Authenticates a user"
- **Location**: Line 10, Column 2

### 4. Method: authenticate
- **Kind**: `method`
- **Parent**: `AuthService`
- **Modifiers**: `["private", "async"]`
- **Signature**: `async authenticate (user: string, pass: string): Promise<User>`
- **Location**: Line 14, Column 2

### 5. Interface: User
- **Kind**: `interface`
- **Exported**: `true`
- **Location**: Line 19, Column 0

### 6. Type Alias: AuthStatus
- **Kind**: `type_alias`
- **Exported**: `true`
- **Location**: Line 25, Column 0

### 7. Enum: UserRole
- **Kind**: `enum`
- **Exported**: `true`
- **Location**: Line 27, Column 0

### 8. Enum Member: Admin
- **Kind**: `enum_member`
- **Parent**: `UserRole`
- **Location**: Line 28, Column 2

### 9. Enum Member: User
- **Kind**: `enum_member`
- **Parent**: `UserRole`
- **Location**: Line 29, Column 2

### 10. Enum Member: Guest
- **Kind**: `enum_member`
- **Parent**: `UserRole`
- **Location**: Line 30, Column 2

### 11. Arrow Function: createUser
- **Kind**: `arrow_function`
- **Exported**: `true`
- **Modifiers**: `["async", "const"]`
- **Signature**: `createUser (data: UserData): Promise<User>`
- **Location**: Line 33, Column 0

## Key Features Demonstrated

1. **Complete Symbol Extraction**: All code constructs detected
2. **Hierarchy Tracking**: Methods and properties linked to parent class
3. **Export Detection**: Named exports properly identified
4. **Modifier Detection**: async, private, static, readonly, etc.
5. **Documentation Extraction**: JSDoc comments preserved
6. **Signature Generation**: Full function/method signatures
7. **Location Tracking**: Precise line and column numbers
8. **Type Information**: TypeScript types preserved in signatures

## Usage

```typescript
import { extractSymbols } from './src/core/ast/symbol-extractor.js';

const code = `/* your code here */`;
const symbols = extractSymbols(code, '/path/to/file.ts', 'file.ts', '.ts');

console.log(`Found ${symbols.length} symbols`);
symbols.forEach(sym => {
  console.log(`${sym.kind}: ${sym.name}`);
  if (sym.signature) {
    console.log(`  Signature: ${sym.signature}`);
  }
  if (sym.parentId) {
    console.log(`  Parent: ${sym.parentId}`);
  }
});
```

## Test Coverage

All features tested with 34 comprehensive unit tests:
- ✅ Function declarations (regular, async, generator)
- ✅ Arrow functions (const, exported, async)
- ✅ Classes (simple, exported, default)
- ✅ Class methods (static, async, parent refs)
- ✅ Class properties (readonly, modifiers)
- ✅ TypeScript interfaces
- ✅ TypeScript type aliases
- ✅ TypeScript enums + members
- ✅ JSDoc extraction
- ✅ Location tracking
- ✅ Export detection
- ✅ Error handling
- ✅ ID generation
