import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const DEFAULT_PROFILE_NAME = 'default';
const PROFILE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

interface ProfilesState {
  activeProfile?: string;
  profiles?: string[];
}

export interface LgrepProfileInfo {
  name: string;
  path: string;
  isActive: boolean;
  exists: boolean;
}

function getPlatformDefaultHome(): string {
  const platform = process.platform;
  const home = homedir();

  switch (platform) {
    case 'darwin':
      return join(home, 'Library', 'Application Support', 'lgrep');
    case 'win32': {
      const appData = process.env['APPDATA'];
      if (appData) {
        return join(appData, 'lgrep');
      }
      return join(home, 'AppData', 'Roaming', 'lgrep');
    }
    default: {
      const xdgDataHome = process.env['XDG_DATA_HOME'];
      if (xdgDataHome) {
        return join(xdgDataHome, 'lgrep');
      }
      return join(home, '.local', 'share', 'lgrep');
    }
  }
}

export function getLgrepBaseHome(): string {
  return getPlatformDefaultHome();
}

export function getProfilesDir(): string {
  return join(getLgrepBaseHome(), 'profiles');
}

export function getProfilesStatePath(): string {
  return join(getLgrepBaseHome(), '.profiles.json');
}

export function isExplicitLgrepHome(): boolean {
  return Boolean(process.env['LGREP_HOME']);
}

function loadProfilesState(): ProfilesState {
  try {
    const path = getProfilesStatePath();
    if (existsSync(path)) {
      return JSON.parse(readFileSync(path, 'utf-8')) as ProfilesState;
    }
  } catch {
    // Ignore corrupted profile state and fall back to defaults.
  }

  return {};
}

function saveProfilesState(state: ProfilesState): void {
  const baseHome = getLgrepBaseHome();
  if (!existsSync(baseHome)) {
    mkdirSync(baseHome, { recursive: true });
  }

  writeFileSync(getProfilesStatePath(), JSON.stringify(state, null, 2), 'utf-8');
}

export function validateProfileName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error('Profile name cannot be empty');
  }
  if (!PROFILE_NAME_PATTERN.test(trimmed)) {
    throw new Error('Profile name may contain only letters, numbers, dot, underscore, and hyphen');
  }
  return trimmed;
}

export function getActiveProfileName(): string {
  const envProfile = process.env['LGREP_PROFILE']?.trim();
  if (envProfile) {
    return envProfile;
  }

  return loadProfilesState().activeProfile?.trim() || DEFAULT_PROFILE_NAME;
}

export function getProfileHome(profileName = getActiveProfileName()): string {
  const normalized = validateProfileName(profileName);
  if (normalized === DEFAULT_PROFILE_NAME) {
    return getLgrepBaseHome();
  }
  return join(getProfilesDir(), normalized);
}

export function setActiveProfileName(profileName: string): void {
  const normalized = validateProfileName(profileName);
  const state = loadProfilesState();
  const knownProfiles = new Set(state.profiles ?? []);
  if (normalized !== DEFAULT_PROFILE_NAME) {
    knownProfiles.add(normalized);
  }

  state.activeProfile = normalized;
  state.profiles = Array.from(knownProfiles).sort();
  saveProfilesState(state);
}

export function createProfile(profileName: string): { created: boolean; path: string } {
  const normalized = validateProfileName(profileName);
  const profilePath = getProfileHome(normalized);
  const created = !existsSync(profilePath);
  mkdirSync(profilePath, { recursive: true });

  const state = loadProfilesState();
  const knownProfiles = new Set(state.profiles ?? []);
  if (normalized !== DEFAULT_PROFILE_NAME) {
    knownProfiles.add(normalized);
    state.profiles = Array.from(knownProfiles).sort();
    saveProfilesState(state);
  }

  return { created, path: profilePath };
}

export function profileExists(profileName: string): boolean {
  const normalized = validateProfileName(profileName);
  if (normalized === DEFAULT_PROFILE_NAME) {
    return true;
  }

  if (existsSync(getProfileHome(normalized))) {
    return true;
  }

  const state = loadProfilesState();
  return (state.profiles ?? []).includes(normalized);
}

export function listProfiles(): LgrepProfileInfo[] {
  const activeProfile = getActiveProfileName();
  const state = loadProfilesState();
  const names = new Set<string>([DEFAULT_PROFILE_NAME, ...(state.profiles ?? [])]);

  if (existsSync(getProfilesDir())) {
    for (const entry of readdirSync(getProfilesDir())) {
      const entryPath = join(getProfilesDir(), entry);
      try {
        if (statSync(entryPath).isDirectory()) {
          names.add(entry);
        }
      } catch {
        // Ignore unreadable entries.
      }
    }
  }

  return Array.from(names)
    .sort((left, right) => {
      if (left === DEFAULT_PROFILE_NAME) return -1;
      if (right === DEFAULT_PROFILE_NAME) return 1;
      return left.localeCompare(right);
    })
    .map((name) => {
      const path = getProfileHome(name);
      return {
        name,
        path,
        isActive: name === activeProfile,
        exists: existsSync(path),
      };
    });
}
