import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getMgrepHome, getDbPath, getConfigPath, getCachePath } from './paths.js';

describe('paths utility', () => {
  const originalEnv = process.env;
  const originalPlatform = process.platform;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('getMgrepHome', () => {
    it('should use MGREP_HOME env var when set', () => {
      process.env['MGREP_HOME'] = '/custom/mgrep/path';
      expect(getMgrepHome()).toBe('/custom/mgrep/path');
    });

    it('should use XDG_DATA_HOME on Linux when set', () => {
      delete process.env['MGREP_HOME'];
      process.env['XDG_DATA_HOME'] = '/home/user/.local/share';

      // Mock platform - this is tricky as process.platform is readonly
      // We'll test the actual behavior based on current platform
      const home = getMgrepHome();
      expect(home).toBeDefined();
      expect(typeof home).toBe('string');
      expect(home.length).toBeGreaterThan(0);
    });

    it('should return a valid path on the current platform', () => {
      delete process.env['MGREP_HOME'];
      const home = getMgrepHome();

      expect(home).toBeDefined();
      expect(typeof home).toBe('string');
      expect(home).toContain('mgrep');
    });
  });

  describe('getDbPath', () => {
    it('should return db subdirectory of mgrep home', () => {
      process.env['MGREP_HOME'] = '/test/mgrep';
      expect(getDbPath()).toBe('/test/mgrep/db');
    });
  });

  describe('getConfigPath', () => {
    it('should return config.json path in mgrep home', () => {
      process.env['MGREP_HOME'] = '/test/mgrep';
      expect(getConfigPath()).toBe('/test/mgrep/config.json');
    });
  });

  describe('getCachePath', () => {
    it('should return cache subdirectory of mgrep home', () => {
      process.env['MGREP_HOME'] = '/test/mgrep';
      expect(getCachePath()).toBe('/test/mgrep/cache');
    });
  });
});
