'use client';

import { useSyncExternalStore } from 'react';

export interface BrowserCaps {
  /** false during SSR and the first hydration pass */
  ready: boolean;
  usb: boolean;
  serial: boolean;
  dirPicker: boolean;
  secure: boolean;
}

const SERVER: BrowserCaps = { ready: false, usb: false, serial: false, dirPicker: false, secure: false };
let client: BrowserCaps | null = null;

function read(): BrowserCaps {
  client ??= {
    ready: true,
    usb: 'usb' in navigator,
    serial: 'serial' in navigator,
    dirPicker: 'showDirectoryPicker' in window,
    secure: window.isSecureContext,
  };
  return client;
}

const subscribe = () => () => {};

/**
 * Browser API support, without hydration mismatches: the server and the first
 * client render both see `ready: false`, then React re-renders with real values.
 */
export function useBrowserCaps(): BrowserCaps {
  return useSyncExternalStore(subscribe, read, () => SERVER);
}
