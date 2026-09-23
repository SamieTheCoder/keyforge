/** Site-wide settings. Change these to your real GitHub account before publishing. */
export const SITE = {
  name: 'Keyforge',
  url: 'https://keyforge.tech',
  repoUrl: 'https://github.com/SamieTheCoder/keyforge',
  /** owner/name of the repo whose GitHub Actions publish Keyforge firmware releases (usually this repo). */
  firmwareRepo: 'SamieTheCoder/keyforge',
  /** Matches firmware/VERSION. */
  firmwareVersion: '8.0-kf1',
  contactEmail: 'privacy@keyforge.tech',
} as const;
