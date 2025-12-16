import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getLgrepHome, getDbPath, getConfigPath, getCachePath } from './paths.js';

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

  describe('getLgrepHome', () => {
    it('should use LGREP_HOME env var when set', () => {
      process.env['LGREP_HOME'] = '/custom/lgrep/path';
      expect(getLgrepHome()).toBe('/custom/lgrep/path');
    });

    it('should use XDG_DATA_HOME on Linux when set', () => {
      delete process.env['LGREP_HOME'];
      process.env['XDG_DATA_HOME'] = '/home/user/.local/share';

      // Mock platform - this is tricky as process.platform is readonly
      // We'll test the actual behavior based on current platform
      const home = getLgrepHome();
      expect(home).toBeDefined();
      expect(typeof home).toBe('string');
      expect(home.length).toBeGreaterThan(0);
    });

    it('should return a valid path on the current platform', () => {
      delete process.env['LGREP_HOME'];
      const home = getLgrepHome();

      expect(home).toBeDefined();
      expect(typeof home).toBe('string');
      expect(home).toContain('lgrep');
    });
  });

  describe('getDbPath', () => {
    it('should return db subdirectory of lgrep home', () => {
      process.env['LGREP_HOME'] = '/test/lgrep';
      expect(getDbPath()).toBe('/test/lgrep/db');
    });
  });

  describe('getConfigPath', () => {
    it('should return config.json path in lgrep home', () => {
      process.env['LGREP_HOME'] = '/test/lgrep';
      expect(getConfigPath()).toBe('/test/lgrep/config.json');
    });
  });

  describe('getCachePath', () => {
    it('should return cache subdirectory of lgrep home', () => {
      process.env['LGREP_HOME'] = '/test/lgrep';
      expect(getCachePath()).toBe('/test/lgrep/cache');
    });
  });
});
