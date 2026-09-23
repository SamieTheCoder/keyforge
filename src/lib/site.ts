/** Site-wide settings. Change these to your real GitHub account before publishing. */
export const SITE = {
  name: 'Keyzforge',
  url: 'https://keyzforge.xyz',
  repoUrl: 'https://github.com/SamieTheCoder/keyzforge',
  /** owner/name of the repo whose GitHub Actions publish Keyzforge firmware releases (usually this repo). */
  firmwareRepo: 'SamieTheCoder/keyzforge',
  /** Matches firmware/VERSION. */
  firmwareVersion: '8.0-kf1',
  contactEmail: 'privacy@keyzforge.xyz',
} as const;
