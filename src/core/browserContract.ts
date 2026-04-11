import { BrowserType } from '../browser/browserManager.js';
import type { BrowserCapabilityEntry, BrowserCapabilityMatrix, SupportedBrowser } from './types.js';

export type BrowserFeature =
  | 'core_control'
  | 'tab_management'
  | 'network_control'
  | 'web_vitals'
  | 'design_audit'
  | 'profiling'
  | 'extension_augmented';

export interface BrowserCapabilityFlags {
  core_control: boolean;
  tab_management: boolean;
  network_control: boolean;
  web_vitals: boolean;
  design_audit: boolean;
  profiling: boolean;
  extension_augmented: boolean;
}

export interface BrowserTransportState {
  hasCdp: boolean;
  extensionConnected: boolean;
}

export interface BrowserCapabilityReport {
  browser: BrowserType;
  label: string;
  capabilities: BrowserCapabilityFlags;
  notes: string[];
}

export type BrowserWarningCode =
  | 'degraded_execution'
  | 'extension_unavailable'
  | 'cdp_unavailable'
  | 'unsupported_feature';

export interface BrowserWarning {
  code: BrowserWarningCode;
  message: string;
}

export type BrowserArtifactKind = 'screenshot' | 'profile' | 'audit' | 'metrics';

export interface BrowserArtifactRef {
  kind: BrowserArtifactKind;
  description: string;
  path?: string;
  mimeType?: string;
}

export type BrowserErrorCode =
  | 'session_not_found'
  | 'unsupported_browser_feature'
  | 'transport_unavailable'
  | 'invalid_target'
  | 'browser_action_failed'
  | 'browser_launch_failed'
  | 'profile_not_found'
  | 'capsule_not_found'
  | 'extension_unavailable';

export interface BrowserErrorDetail {
  code: BrowserErrorCode;
  message: string;
}

export interface BrowserToolResult<T> {
  success: boolean;
  action: string;
  browser?: BrowserType;
  sessionId?: string;
  data?: T;
  warnings: BrowserWarning[];
  artifacts: BrowserArtifactRef[];
  evidence?: Record<string, unknown>;
  error?: BrowserErrorDetail;
}

function buildCapabilityFlags(
  browser: BrowserType,
  transport?: BrowserTransportState
): BrowserCapabilityFlags {
  const extensionAugmented = transport?.extensionConnected === true;

  switch (browser) {
    case BrowserType.CHROME:
      return {
        core_control: true,
        tab_management: transport?.hasCdp !== false,
        network_control: transport?.hasCdp !== false,
        web_vitals: true,
        design_audit: true,
        profiling: true,
        extension_augmented: extensionAugmented,
      };
    case BrowserType.EDGE:
      return {
        core_control: true,
        tab_management: transport?.hasCdp !== false,
        network_control: transport?.hasCdp !== false,
        web_vitals: true,
        design_audit: true,
        profiling: true,
        extension_augmented: false,
      };
    case BrowserType.FIREFOX:
      return {
        core_control: true,
        tab_management: false,
        network_control: false,
        web_vitals: false,
        design_audit: false,
        profiling: false,
        extension_augmented: false,
      };
    case BrowserType.SAFARI:
      return {
        core_control: false,
        tab_management: false,
        network_control: false,
        web_vitals: false,
        design_audit: false,
        profiling: false,
        extension_augmented: false,
      };
  }
}

function buildNotes(browser: BrowserType, transport?: BrowserTransportState): string[] {
  switch (browser) {
    case BrowserType.CHROME: {
      const notes = ['CDP is the primary control transport for Chrome sessions.'];
      if (transport?.extensionConnected === true) {
        notes.push('Chrome extension augmentation is active for richer browser evidence.');
      } else {
        notes.push('Chrome extension augmentation is not connected; CDP fallbacks remain available.');
      }
      return notes;
    }
    case BrowserType.EDGE:
      return ['Edge uses Chromium CDP control without extension augmentation.'];
    case BrowserType.FIREFOX:
      return ['Firefox uses Marionette/WebDriver-style control with advanced diagnostics disabled.'];
    case BrowserType.SAFARI:
      return ['Safari support is limited to launch and navigation flows until stronger automation primitives are added.'];
  }
}

export function getBrowserCapabilityReport(
  browser: BrowserType,
  transport?: BrowserTransportState
): BrowserCapabilityReport {
  return {
    browser,
    label: browser.charAt(0).toUpperCase() + browser.slice(1),
    capabilities: buildCapabilityFlags(browser, transport),
    notes: buildNotes(browser, transport),
  };
}

export function getAllBrowserCapabilityReports(): BrowserCapabilityReport[] {
  return [
    getBrowserCapabilityReport(BrowserType.CHROME),
    getBrowserCapabilityReport(BrowserType.EDGE),
    getBrowserCapabilityReport(BrowserType.FIREFOX),
    getBrowserCapabilityReport(BrowserType.SAFARI),
  ];
}

export function browserSupportsFeature(
  browser: BrowserType,
  feature: BrowserFeature,
  transport?: BrowserTransportState
): boolean {
  return getBrowserCapabilityReport(browser, transport).capabilities[feature];
}

/** Canonical browser capability matrix */
export const BROWSER_CAPABILITY_MATRIX: BrowserCapabilityMatrix = [
  {
    browser: 'chrome',
    displayName: 'Google Chrome',
    supportLevel: 'full',
    capabilities: [
      'navigate', 'click', 'fill', 'select', 'screenshot', 'pdf',
      'dom-query', 'dom-snapshot', 'a11y-snapshot',
      'console-capture', 'network-capture', 'performance-metrics',
      'cdp-access', 'device-emulation', 'network-throttling',
      'multi-tab', 'cookie-management', 'geolocation',
      'file-upload', 'dialog-handling', 'wait-conditions',
    ],
    limitations: [],
  },
  {
    browser: 'edge',
    displayName: 'Microsoft Edge',
    supportLevel: 'full',
    capabilities: [
      'navigate', 'click', 'fill', 'select', 'screenshot', 'pdf',
      'dom-query', 'dom-snapshot', 'a11y-snapshot',
      'console-capture', 'network-capture', 'performance-metrics',
      'cdp-access', 'device-emulation', 'network-throttling',
      'multi-tab', 'cookie-management', 'geolocation',
      'file-upload', 'dialog-handling', 'wait-conditions',
    ],
    limitations: [
      'Some Edge-specific features may require Edge-specific CDP domains',
    ],
  },
  {
    browser: 'firefox',
    displayName: 'Mozilla Firefox',
    supportLevel: 'core',
    capabilities: [
      'navigate', 'click', 'fill', 'select', 'screenshot',
      'dom-query', 'multi-tab', 'cookie-management',
      'wait-conditions', 'dialog-handling',
    ],
    limitations: [
      'No CDP access (uses Marionette protocol)',
      'No device emulation',
      'No network throttling',
      'No a11y snapshot via CDP',
      'Limited performance metrics',
      'No console capture via CDP',
      'No network request interception',
    ],
  },
  {
    browser: 'safari',
    displayName: 'Apple Safari',
    supportLevel: 'limited',
    capabilities: [
      'navigate', 'click', 'fill', 'select', 'screenshot',
      'dom-query', 'wait-conditions',
    ],
    limitations: [
      'macOS only',
      'No CDP access',
      'No device emulation',
      'No network throttling',
      'No multi-tab management',
      'No console capture',
      'No network request interception',
      'No a11y snapshot',
      'No performance metrics API',
      'Limited cookie management',
      'Requires Safari Technology Preview for WebDriver',
    ],
  },
];

/** Check if a browser supports a specific capability */
export function browserSupportsCapability(browser: SupportedBrowser, capability: string): boolean {
  const entry = BROWSER_CAPABILITY_MATRIX.find(e => e.browser === browser);
  if (!entry) return false;
  return entry.capabilities.includes(capability);
}

/** Get capabilities for a browser */
export function getBrowserCapabilities(browser: SupportedBrowser): BrowserCapabilityEntry | undefined {
  return BROWSER_CAPABILITY_MATRIX.find(e => e.browser === browser);
}

/** Get all supported browsers */
export function getSupportedBrowsers(): readonly SupportedBrowser[] {
  return BROWSER_CAPABILITY_MATRIX.map(e => e.browser);
}
