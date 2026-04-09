import { createProfile, getActiveProfileName, listProfiles, profileExists, setActiveProfileName, type LgrepProfileInfo } from '../utils/profiles.js';

export interface ProfileCreateResult {
  profile: string;
  path: string;
  created: boolean;
}

export interface ProfileUseResult {
  profile: string;
  path: string;
  active: true;
}

export async function runProfileCreateCommand(name: string): Promise<ProfileCreateResult> {
  const result = createProfile(name);
  return {
    profile: name.trim(),
    path: result.path,
    created: result.created,
  };
}

export async function runProfileListCommand(): Promise<{ activeProfile: string; profiles: LgrepProfileInfo[] }> {
  return {
    activeProfile: getActiveProfileName(),
    profiles: listProfiles(),
  };
}

export async function runProfileUseCommand(name: string): Promise<ProfileUseResult> {
  const normalized = name.trim();
  if (!profileExists(normalized)) {
    throw new Error(`Profile "${normalized}" does not exist. Run: lgrep profile create ${normalized}`);
  }

  setActiveProfileName(normalized);
  const profile = listProfiles().find((entry) => entry.name === normalized);
  return {
    profile: normalized,
    path: profile?.path ?? '',
    active: true,
  };
}
