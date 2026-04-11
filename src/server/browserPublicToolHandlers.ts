import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve as pathResolve } from 'node:path';
import { z } from 'zod';
import { getLogger } from '../infra/logger.js';
import {
  BrowserType,
  getBrowserManager,
  type BrowserConfig,
  type BrowserSessionTransportInfo,
} from '../browser/browserManager.js';
import {
  browserSupportsFeature,
  browserSupportsCapability,
  getAllBrowserCapabilityReports,
  getBrowserCapabilityReport,
  type BrowserArtifactRef,
  type BrowserErrorCode,
  type BrowserToolResult,
  type BrowserWarning,
} from '../core/browserContract.js';
import type { SupportedBrowser } from '../core/types.js';
import { getNetworkPresets } from '../browser/networkControl.js';
import { getEvidenceCapsuleCollector } from '../core/evidenceCapsule.js';
import { getFailureClassifier } from '../core/failureClassifier.js';
import { getAssertionEvaluator } from '../core/assertionModel.js';
import { getFixVerifier } from '../core/fixVerification.js';
import { getRootCauseMapper } from '../core/rootCauseMapper.js';
import { getFlakeAnalyzer } from '../core/flakeAnalyzer.js';
import { getWorkflowRecorder } from '../core/workflowRecorder.js';
import { getPRSummaryGenerator } from '../core/prSummaryGenerator.js';

const logger = getLogger('browser-public-tool-handlers');
const browserManager = getBrowserManager();
const artifactDir = pathResolve(process.cwd(), 'artifacts', 'browser');

type JsonRecord = Record<string, unknown>;

const BrowserTypeSchema = z.enum(['chrome', 'edge', 'firefox', 'safari']);
const WaitStrategySchema = z.enum(['load', 'networkidle', 'selector']).default('networkidle');

const BrowserCapabilitiesSchema = z.object({
  browser: BrowserTypeSchema.optional(),
  sessionId: z.string().optional(),
});

const BrowserSessionOpenSchema = z.object({
  browserType: BrowserTypeSchema,
  headless: z.boolean().default(true),
  url: z.string().optional(),
  viewport: z.object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    deviceScaleFactor: z.number().positive().optional(),
  }).optional(),
  userAgent: z.string().optional(),
  locale: z.string().optional(),
  timezone: z.string().optional(),
});

const BrowserSessionCloseSchema = z.object({
  sessionId: z.string(),
});

const BrowserSessionListSchema = z.object({
  activeOnly: z.boolean().default(true),
});

const BrowserNavigateSchema = z.object({
  sessionId: z.string(),
  url: z.string(),
  waitFor: WaitStrategySchema,
  timeoutMs: z.number().int().positive().default(30000),
});

const BrowserScreenshotSchema = z.object({
  sessionId: z.string(),
  fullPage: z.boolean().default(false),
  type: z.enum(['png', 'jpeg']).default('png'),
  quality: z.number().int().min(0).max(100).default(80),
});

const BrowserEvaluateSchema = z.object({
  sessionId: z.string(),
  script: z.string(),
});

const BrowserClickSchema = z.object({
  sessionId: z.string(),
  selector: z.string(),
});

const BrowserTypeTextSchema = z.object({
  sessionId: z.string(),
  selector: z.string(),
  text: z.string(),
  clearFirst: z.boolean().default(true),
  pressEnter: z.boolean().default(false),
});

const BrowserFillFormSchema = z.object({
  sessionId: z.string(),
  fields: z.array(z.object({
    selector: z.string(),
    value: z.string(),
    type: z.enum(['text', 'select', 'checkbox', 'radio', 'click']),
  })),
});

const BrowserHoverSchema = z.object({
  sessionId: z.string(),
  selector: z.string(),
});

const BrowserWaitForSchema = z.object({
  sessionId: z.string(),
  selector: z.string(),
  timeoutMs: z.number().int().positive().default(10000),
});

const BrowserTabCreateSchema = z.object({
  sessionId: z.string(),
  url: z.string().optional(),
});

const BrowserTabMutationSchema = z.object({
  sessionId: z.string(),
  tabId: z.string(),
});

const BrowserTabSwitchSchema = z.object({
  tabId: z.string(),
});

const BrowserNetworkSetSchema = z.object({
  sessionId: z.string(),
  preset: z.string(),
});

const BrowserMetricsSchema = z.object({
  sessionId: z.string(),
});

const BrowserProfileStartSchema = z.object({
  sessionId: z.string(),
});

const BrowserProfileStopSchema = z.object({
  sessionId: z.string(),
  profilingId: z.string(),
});

const BrowserEvidenceCaptureSchema = z.object({
  failureType: z.string(),
  failureMessage: z.string(),
  failureStack: z.string().optional(),
});

const BrowserEvidenceExplainSchema = z.object({
  capsuleId: z.string(),
});

const BrowserAssertionsEvaluateSchema = z.object({
  capsuleId: z.string(),
});

const BrowserVerificationRunSchema = z.object({
  patchId: z.string(),
  originalCapsuleId: z.string(),
  rerunCount: z.number().int().min(1).max(10).optional(),
});

const BrowserFlakeAnalysisSchema = z.object({
  capsuleIds: z.array(z.string()).min(1),
});

const BrowserEvidenceRootCauseSchema = z.object({
  capsuleId: z.string(),
});

const BrowserPRSummaryGenerateSchema = z.object({
  capsuleId: z.string(),
});

// ===========================================================================
// Workflow Recorder Schemas
// ===========================================================================

const BrowserRecorderStartSchema = z.object({
  name: z.string().min(1),
});

const BrowserRecorderStopSchema = z.object({
  workflowId: z.string(),
});

const BrowserRecorderExportSchema = z.object({
  workflowId: z.string(),
});

function encodeResponse(payload: unknown, isError: boolean = false) {
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(payload, null, 2),
      },
    ],
    ...(isError ? { isError: true } : {}),
  };
}

function baseResult<T>(
  action: string,
  browser?: BrowserType,
  sessionId?: string
): BrowserToolResult<T> {
  return {
    success: true,
    action,
    ...(browser !== undefined ? { browser } : {}),
    ...(sessionId !== undefined ? { sessionId } : {}),
    warnings: [],
    artifacts: [],
  };
}

function failureResult(
  action: string,
  code: BrowserErrorCode,
  message: string,
  browser?: BrowserType,
  sessionId?: string,
  warnings: BrowserWarning[] = [],
  evidence?: Record<string, unknown>
): BrowserToolResult<never> {
  return {
    success: false,
    action,
    ...(browser !== undefined ? { browser } : {}),
    ...(sessionId !== undefined ? { sessionId } : {}),
    warnings,
    artifacts: [],
    ...(evidence !== undefined ? { evidence } : {}),
    error: {
      code,
      message,
    },
  };
}

async function writeArtifact(
  prefix: string,
  extension: string,
  content: string
): Promise<BrowserArtifactRef> {
  await mkdir(artifactDir, { recursive: true });
  const filename = `${prefix}_${Date.now()}.${extension}`;
  const filepath = pathResolve(artifactDir, filename);
  const buffer = extension === 'json'
    ? Buffer.from(content, 'utf8')
    : Buffer.from(content, 'base64');
  await writeFile(filepath, buffer);

  return {
    kind: extension === 'json' ? 'profile' : 'screenshot',
    description: `Saved ${prefix} artifact`,
    path: filepath,
    mimeType: extension === 'json'
      ? 'application/json'
      : extension === 'jpeg'
        ? 'image/jpeg'
        : 'image/png',
  };
}

function toBrowserType(browser: z.infer<typeof BrowserTypeSchema>): BrowserType {
  switch (browser) {
    case 'chrome':
      return BrowserType.CHROME;
    case 'edge':
      return BrowserType.EDGE;
    case 'firefox':
      return BrowserType.FIREFOX;
    case 'safari':
      return BrowserType.SAFARI;
  }
}

function transportWarnings(action: string, transport: BrowserSessionTransportInfo): BrowserWarning[] {
  const warnings: BrowserWarning[] = [];
  if (transport.browserType === BrowserType.CHROME && !transport.extensionConnected) {
    warnings.push({
      code: 'extension_unavailable',
      message: `${action} is running without Chrome extension augmentation; CDP fallbacks are in use.`,
    });
  }
  if (!transport.hasCdp && (action.startsWith('browser.tabs') || action.startsWith('browser.network') || action.startsWith('browser.metrics'))) {
    warnings.push({
      code: 'cdp_unavailable',
      message: `${action} requires a CDP-capable session for full fidelity.`,
    });
  }
  return warnings;
}

function requireTransport(sessionId: string): BrowserSessionTransportInfo {
  return browserManager.getSessionTransportInfo(sessionId);
}

function requireFeature(
  action: string,
  transport: BrowserSessionTransportInfo,
  feature: Parameters<typeof browserSupportsFeature>[1]
): BrowserToolResult<never> | null {
  if (browserSupportsFeature(transport.browserType, feature, {
    hasCdp: transport.hasCdp,
    extensionConnected: transport.extensionConnected,
  })) {
    return null;
  }

  return failureResult(
    action,
    'unsupported_browser_feature',
    `${feature} is not available for ${transport.browserType} sessions`,
    transport.browserType,
    undefined,
    [
      {
        code: 'unsupported_feature',
        message: `${transport.browserType} does not support ${feature} in the current browser contract.`,
      },
    ],
    { capabilityReport: getBrowserCapabilityReport(transport.browserType, transport) }
  );
}

/**
 * Assert that a browser supports a specific capability.
 * Throws an error if the capability is not supported.
 */
function assertBrowserCapability(browser: SupportedBrowser, capability: string): void {
  if (!browserSupportsCapability(browser, capability)) {
    throw new Error(
      `Browser '${browser}' does not support capability '${capability}'`
    );
  }
}

export function registerBrowserPublicTools(server: McpServer): void {
  server.registerTool(
    'browser.capabilities',
    {
      title: 'Browser Capabilities',
      description: 'Report the supported browser capability matrix and active transport state.',
      inputSchema: BrowserCapabilitiesSchema,
    },
    async (args) => {
      try {
        if (args.sessionId !== undefined) {
          const transport = requireTransport(args.sessionId);
          return encodeResponse({
            ...baseResult('browser.capabilities', transport.browserType, args.sessionId),
            data: {
              capabilityReport: getBrowserCapabilityReport(transport.browserType, {
                hasCdp: transport.hasCdp,
                extensionConnected: transport.extensionConnected,
              }),
              transport,
            },
          });
        }

        if (args.browser !== undefined) {
          const browserType = toBrowserType(args.browser);
          return encodeResponse({
            ...baseResult('browser.capabilities', browserType),
            data: {
              capabilityReport: getBrowserCapabilityReport(browserType),
            },
          });
        }

        return encodeResponse({
          ...baseResult('browser.capabilities'),
          data: {
            browsers: getAllBrowserCapabilityReports(),
            activeSessions: browserManager.getActiveSessions().map((session) => ({
              sessionId: session.sessionId,
              browserType: session.browserType,
            })),
          },
        });
      } catch (error) {
        return encodeResponse(
          failureResult(
            'browser.capabilities',
            'browser_action_failed',
            error instanceof Error ? error.message : String(error)
          ),
          true
        );
      }
    }
  );

  server.registerTool(
    'browser.session.open',
    {
      title: 'Open Browser Session',
      description: 'Launch a browser session and optionally navigate to a starting URL.',
      inputSchema: BrowserSessionOpenSchema,
    },
    async (args) => {
      try {
        const browserType = toBrowserType(args.browserType);
        const viewport = args.viewport !== undefined
          ? {
              width: args.viewport.width,
              height: args.viewport.height,
              ...(args.viewport.deviceScaleFactor !== undefined
                ? { deviceScaleFactor: args.viewport.deviceScaleFactor }
                : {}),
            }
          : undefined;

        const config: BrowserConfig = {
          type: browserType,
          headless: args.headless,
          ...(viewport !== undefined ? { viewport } : {}),
          ...(args.userAgent !== undefined ? { userAgent: args.userAgent } : {}),
          ...(args.locale !== undefined ? { locale: args.locale } : {}),
          ...(args.timezone !== undefined ? { timezone: args.timezone } : {}),
        };

        const sessionId = await browserManager.launchBrowser(config);
        const transport = requireTransport(sessionId);
        const warnings = transportWarnings('browser.session.open', transport);
        let navigation: JsonRecord | undefined;

        if (args.url !== undefined) {
          const result = await browserManager.navigate(sessionId, args.url, {
            waitFor: 'networkidle',
            timeout: 30000,
          });
          navigation = result as unknown as JsonRecord;
        }

        return encodeResponse({
          ...baseResult('browser.session.open', browserType, sessionId),
          warnings,
          data: {
            sessionId,
            browserType,
            transport,
            capabilityReport: getBrowserCapabilityReport(browserType, transport),
            ...(navigation !== undefined ? { navigation } : {}),
          },
        });
      } catch (error) {
        return encodeResponse(
          failureResult(
            'browser.session.open',
            'browser_launch_failed',
            error instanceof Error ? error.message : String(error)
          ),
          true
        );
      }
    }
  );

  server.registerTool(
    'browser.session.close',
    {
      title: 'Close Browser Session',
      description: 'Close an active browser session.',
      inputSchema: BrowserSessionCloseSchema,
    },
    async (args) => {
      try {
        const transport = requireTransport(args.sessionId);
        await browserManager.closeSession(args.sessionId);
        return encodeResponse({
          ...baseResult('browser.session.close', transport.browserType, args.sessionId),
          data: { status: 'closed' },
        });
      } catch (error) {
        return encodeResponse(
          failureResult(
            'browser.session.close',
            'session_not_found',
            error instanceof Error ? error.message : String(error),
            undefined,
            args.sessionId
          ),
          true
        );
      }
    }
  );

  server.registerTool(
    'browser.session.list',
    {
      title: 'List Browser Sessions',
      description: 'List the current tracked browser sessions.',
      inputSchema: BrowserSessionListSchema,
    },
    async (args) => {
      const sessions = browserManager.getActiveSessions()
        .filter((session) => args.activeOnly ? session.isActive : true)
        .map((session) => {
          const transport = browserManager.getSessionTransportInfo(session.sessionId);
          return {
            sessionId: session.sessionId,
            browserType: session.browserType,
            createdAt: session.createdAt,
            lastActivity: session.lastActivity,
            transport,
            capabilityReport: getBrowserCapabilityReport(session.browserType, transport),
          };
        });

      return encodeResponse({
        ...baseResult('browser.session.list'),
        data: { sessions },
      });
    }
  );

  server.registerTool(
    'browser.navigate',
    {
      title: 'Navigate Browser',
      description: 'Navigate an active browser session to a URL.',
      inputSchema: BrowserNavigateSchema,
    },
    async (args) => {
      try {
        const transport = requireTransport(args.sessionId);
        const unsupported = requireFeature('browser.navigate', transport, 'core_control');
        if (unsupported) {
          return encodeResponse(unsupported, true);
        }
        const result = await browserManager.navigate(args.sessionId, args.url, {
          waitFor: args.waitFor,
          timeout: args.timeoutMs,
        });
        return encodeResponse({
          ...baseResult('browser.navigate', transport.browserType, args.sessionId),
          warnings: transportWarnings('browser.navigate', transport),
          data: result,
        });
      } catch (error) {
        return encodeResponse(
          failureResult('browser.navigate', 'browser_action_failed', error instanceof Error ? error.message : String(error), undefined, args.sessionId),
          true
        );
      }
    }
  );

  server.registerTool(
    'browser.screenshot',
    {
      title: 'Capture Screenshot',
      description: 'Capture a screenshot and store it as a browser artifact.',
      inputSchema: BrowserScreenshotSchema,
    },
    async (args) => {
      try {
        const transport = requireTransport(args.sessionId);
        const unsupported = requireFeature('browser.screenshot', transport, 'core_control');
        if (unsupported) {
          return encodeResponse(unsupported, true);
        }
        const base64Data = await browserManager.takeScreenshot(args.sessionId, {
          fullPage: args.fullPage,
          type: args.type,
          quality: args.quality,
          encoding: 'base64',
        });
        const artifact = await writeArtifact(`screenshot_${args.sessionId}`, args.type, base64Data);
        return encodeResponse({
          ...baseResult('browser.screenshot', transport.browserType, args.sessionId),
          warnings: transportWarnings('browser.screenshot', transport),
          artifacts: [artifact],
          data: {
            fullPage: args.fullPage,
            format: args.type,
          },
        });
      } catch (error) {
        return encodeResponse(
          failureResult('browser.screenshot', 'browser_action_failed', error instanceof Error ? error.message : String(error), undefined, args.sessionId),
          true
        );
      }
    }
  );

  server.registerTool(
    'browser.evaluate',
    {
      title: 'Evaluate Script',
      description: 'Execute JavaScript in the current page context.',
      inputSchema: BrowserEvaluateSchema,
    },
    async (args) => {
      try {
        const transport = requireTransport(args.sessionId);
        const unsupported = requireFeature('browser.evaluate', transport, 'core_control');
        if (unsupported) {
          return encodeResponse(unsupported, true);
        }
        const result = await browserManager.executeScript(args.sessionId, args.script);
        return encodeResponse({
          ...baseResult('browser.evaluate', transport.browserType, args.sessionId),
          warnings: transportWarnings('browser.evaluate', transport),
          data: { result },
        });
      } catch (error) {
        return encodeResponse(
          failureResult('browser.evaluate', 'browser_action_failed', error instanceof Error ? error.message : String(error), undefined, args.sessionId),
          true
        );
      }
    }
  );

  server.registerTool(
    'browser.click',
    {
      title: 'Click Element',
      description: 'Click a page element by CSS selector.',
      inputSchema: BrowserClickSchema,
    },
    async (args) => {
      try {
        const transport = requireTransport(args.sessionId);
        const unsupported = requireFeature('browser.click', transport, 'core_control');
        if (unsupported) {
          return encodeResponse(unsupported, true);
        }
        const result = await browserManager.click(args.sessionId, args.selector);
        return encodeResponse({
          ...baseResult('browser.click', transport.browserType, args.sessionId),
          warnings: transportWarnings('browser.click', transport),
          data: result,
        });
      } catch (error) {
        return encodeResponse(
          failureResult('browser.click', 'invalid_target', error instanceof Error ? error.message : String(error), undefined, args.sessionId),
          true
        );
      }
    }
  );

  server.registerTool(
    'browser.type',
    {
      title: 'Type Text',
      description: 'Type text into a page input.',
      inputSchema: BrowserTypeTextSchema,
    },
    async (args) => {
      try {
        const transport = requireTransport(args.sessionId);
        const unsupported = requireFeature('browser.type', transport, 'core_control');
        if (unsupported) {
          return encodeResponse(unsupported, true);
        }
        const result = await browserManager.type(args.sessionId, args.selector, args.text, {
          clearFirst: args.clearFirst,
          pressEnter: args.pressEnter,
        });
        return encodeResponse({
          ...baseResult('browser.type', transport.browserType, args.sessionId),
          warnings: transportWarnings('browser.type', transport),
          data: result,
        });
      } catch (error) {
        return encodeResponse(
          failureResult('browser.type', 'invalid_target', error instanceof Error ? error.message : String(error), undefined, args.sessionId),
          true
        );
      }
    }
  );

  server.registerTool(
    'browser.fill_form',
    {
      title: 'Fill Form',
      description: 'Fill multiple form fields using one browser action.',
      inputSchema: BrowserFillFormSchema,
    },
    async (args) => {
      try {
        const transport = requireTransport(args.sessionId);
        const unsupported = requireFeature('browser.fill_form', transport, 'core_control');
        if (unsupported) {
          return encodeResponse(unsupported, true);
        }
        const result = await browserManager.fillForm(args.sessionId, args.fields);
        return encodeResponse({
          ...baseResult('browser.fill_form', transport.browserType, args.sessionId),
          warnings: transportWarnings('browser.fill_form', transport),
          data: result,
        });
      } catch (error) {
        return encodeResponse(
          failureResult('browser.fill_form', 'invalid_target', error instanceof Error ? error.message : String(error), undefined, args.sessionId),
          true
        );
      }
    }
  );

  server.registerTool(
    'browser.hover',
    {
      title: 'Hover Element',
      description: 'Hover over a page element by CSS selector.',
      inputSchema: BrowserHoverSchema,
    },
    async (args) => {
      try {
        const transport = requireTransport(args.sessionId);
        const unsupported = requireFeature('browser.hover', transport, 'core_control');
        if (unsupported) {
          return encodeResponse(unsupported, true);
        }
        const result = await browserManager.hover(args.sessionId, args.selector);
        return encodeResponse({
          ...baseResult('browser.hover', transport.browserType, args.sessionId),
          warnings: transportWarnings('browser.hover', transport),
          data: result,
        });
      } catch (error) {
        return encodeResponse(
          failureResult('browser.hover', 'invalid_target', error instanceof Error ? error.message : String(error), undefined, args.sessionId),
          true
        );
      }
    }
  );

  server.registerTool(
    'browser.wait_for',
    {
      title: 'Wait For Element',
      description: 'Wait for an element to appear and report whether it is visible.',
      inputSchema: BrowserWaitForSchema,
    },
    async (args) => {
      try {
        const transport = requireTransport(args.sessionId);
        const unsupported = requireFeature('browser.wait_for', transport, 'core_control');
        if (unsupported) {
          return encodeResponse(unsupported, true);
        }
        const result = await browserManager.waitFor(args.sessionId, args.selector, args.timeoutMs);
        return encodeResponse({
          ...baseResult('browser.wait_for', transport.browserType, args.sessionId),
          warnings: transportWarnings('browser.wait_for', transport),
          data: result,
        });
      } catch (error) {
        return encodeResponse(
          failureResult('browser.wait_for', 'browser_action_failed', error instanceof Error ? error.message : String(error), undefined, args.sessionId),
          true
        );
      }
    }
  );

  server.registerTool(
    'browser.tabs.list',
    {
      title: 'List Tabs',
      description: 'List tabs for a CDP-capable browser session.',
      inputSchema: BrowserSessionCloseSchema,
    },
    async (args) => {
      try {
        const transport = requireTransport(args.sessionId);
        const unsupported = requireFeature('browser.tabs.list', transport, 'tab_management');
        if (unsupported) {
          return encodeResponse(unsupported, true);
        }
        const tabs = await browserManager.listTabs(args.sessionId);
        return encodeResponse({
          ...baseResult('browser.tabs.list', transport.browserType, args.sessionId),
          warnings: transportWarnings('browser.tabs.list', transport),
          data: { tabs },
        });
      } catch (error) {
        return encodeResponse(
          failureResult('browser.tabs.list', 'browser_action_failed', error instanceof Error ? error.message : String(error), undefined, args.sessionId),
          true
        );
      }
    }
  );

  server.registerTool(
    'browser.tabs.create',
    {
      title: 'Create Tab',
      description: 'Create a new tab for a CDP-capable browser session.',
      inputSchema: BrowserTabCreateSchema,
    },
    async (args) => {
      try {
        const transport = requireTransport(args.sessionId);
        const unsupported = requireFeature('browser.tabs.create', transport, 'tab_management');
        if (unsupported) {
          return encodeResponse(unsupported, true);
        }
        const tab = await browserManager.createTab(args.sessionId, args.url);
        return encodeResponse({
          ...baseResult('browser.tabs.create', transport.browserType, args.sessionId),
          warnings: transportWarnings('browser.tabs.create', transport),
          data: tab,
        });
      } catch (error) {
        return encodeResponse(
          failureResult('browser.tabs.create', 'browser_action_failed', error instanceof Error ? error.message : String(error), undefined, args.sessionId),
          true
        );
      }
    }
  );

  server.registerTool(
    'browser.tabs.activate',
    {
      title: 'Activate Tab',
      description: 'Activate a tab for a CDP-capable browser session.',
      inputSchema: BrowserTabMutationSchema,
    },
    async (args) => {
      try {
        const transport = requireTransport(args.sessionId);
        const unsupported = requireFeature('browser.tabs.activate', transport, 'tab_management');
        if (unsupported) {
          return encodeResponse(unsupported, true);
        }
        await browserManager.activateTab(args.sessionId, args.tabId);
        return encodeResponse({
          ...baseResult('browser.tabs.activate', transport.browserType, args.sessionId),
          warnings: transportWarnings('browser.tabs.activate', transport),
          data: { tabId: args.tabId, status: 'activated' },
        });
      } catch (error) {
        return encodeResponse(
          failureResult('browser.tabs.activate', 'browser_action_failed', error instanceof Error ? error.message : String(error), undefined, args.sessionId),
          true
        );
      }
    }
  );

  server.registerTool(
    'browser.tabs.close',
    {
      title: 'Close Tab',
      description: 'Close a tab for a CDP-capable browser session.',
      inputSchema: BrowserTabMutationSchema,
    },
    async (args) => {
      try {
        const transport = requireTransport(args.sessionId);
        const unsupported = requireFeature('browser.tabs.close', transport, 'tab_management');
        if (unsupported) {
          return encodeResponse(unsupported, true);
        }
        await browserManager.closeTab(args.sessionId, args.tabId);
        return encodeResponse({
          ...baseResult('browser.tabs.close', transport.browserType, args.sessionId),
          warnings: transportWarnings('browser.tabs.close', transport),
          data: { tabId: args.tabId, status: 'closed' },
        });
      } catch (error) {
        return encodeResponse(
          failureResult('browser.tabs.close', 'browser_action_failed', error instanceof Error ? error.message : String(error), undefined, args.sessionId),
          true
        );
      }
    }
  );

  // ============================================================================
  // Extension Bridge Tab Tools (no sessionId required - uses browser extension)
  // ============================================================================

  server.registerTool(
    'browser.tabs.list_all',
    {
      title: 'List All Tabs',
      description: 'List all managed tabs from the browser extension bridge. Returns tabId, url, title, and isActive for each tab. No sessionId required.',
      inputSchema: z.object({}), // No required inputs
    },
    async (_args) => {
      try {
        const { getExtensionBridge } = await import('../browser/extensionBridge.js');
        const bridge = getExtensionBridge();
        const connectedExtensions = bridge.getConnectedExtensions();

        if (connectedExtensions.length === 0) {
          return encodeResponse({
            ...baseResult('browser.tabs.list_all'),
            data: { tabs: [] },
            warnings: [{
              code: 'extension_unavailable',
              message: 'No browser extension connected. Please connect the browser extension to use tab management.',
            }],
          });
        }

        const extensionId = connectedExtensions[0]!;
        const result = await bridge.sendCommand(extensionId, 'getTabs', {});

        // Normalize the response
        const tabs = Array.isArray(result)
          ? result.map((tab: unknown) => {
              const t = tab as Record<string, unknown>;
              return {
                tabId: String(t['tabId'] ?? t['id'] ?? ''),
                url: String(t['url'] ?? ''),
                title: String(t['title'] ?? ''),
                isActive: Boolean(t['isActive'] ?? t['active'] ?? false),
              };
            })
          : [];

        return encodeResponse({
          ...baseResult('browser.tabs.list_all'),
          data: { tabs },
        });
      } catch (error) {
        return encodeResponse(
          failureResult(
            'browser.tabs.list_all',
            'browser_action_failed',
            error instanceof Error ? error.message : String(error)
          ),
          true
        );
      }
    }
  );

  server.registerTool(
    'browser.tabs.switch',
    {
      title: 'Switch Tab',
      description: 'Activate/switch to a specific tab by tabId via the browser extension bridge.',
      inputSchema: BrowserTabSwitchSchema,
    },
    async (args) => {
      try {
        const { getExtensionBridge } = await import('../browser/extensionBridge.js');
        const bridge = getExtensionBridge();
        const connectedExtensions = bridge.getConnectedExtensions();

        if (connectedExtensions.length === 0) {
          return encodeResponse(
            failureResult(
              'browser.tabs.switch',
              'transport_unavailable',
              'No browser extension connected. Please connect the browser extension to use tab management.'
            ),
            true
          );
        }

        const extensionId = connectedExtensions[0]!;
        await bridge.sendCommand(extensionId, 'activateTab', { tabId: args.tabId });

        return encodeResponse({
          ...baseResult('browser.tabs.switch'),
          data: { tabId: args.tabId, status: 'activated' },
        });
      } catch (error) {
        return encodeResponse(
          failureResult(
            'browser.tabs.switch',
            'browser_action_failed',
            error instanceof Error ? error.message : String(error)
          ),
          true
        );
      }
    }
  );

  server.registerTool(
    'browser.network.set_conditions',
    {
      title: 'Set Network Conditions',
      description: 'Apply a named network throttling preset.',
      inputSchema: BrowserNetworkSetSchema,
    },
    async (args) => {
      const presets = getNetworkPresets();
      if (!(args.preset in presets)) {
        return encodeResponse(
          failureResult(
            'browser.network.set_conditions',
            'browser_action_failed',
            `Unknown network preset '${args.preset}'`
          ),
          true
        );
      }

      try {
        const transport = requireTransport(args.sessionId);
        const unsupported = requireFeature('browser.network.set_conditions', transport, 'network_control');
        if (unsupported) {
          return encodeResponse(unsupported, true);
        }
        await browserManager.setNetworkPreset(args.sessionId, args.preset);
        return encodeResponse({
          ...baseResult('browser.network.set_conditions', transport.browserType, args.sessionId),
          warnings: transportWarnings('browser.network.set_conditions', transport),
          data: { preset: args.preset },
        });
      } catch (error) {
        return encodeResponse(
          failureResult('browser.network.set_conditions', 'browser_action_failed', error instanceof Error ? error.message : String(error), undefined, args.sessionId),
          true
        );
      }
    }
  );

  server.registerTool(
    'browser.network.reset',
    {
      title: 'Reset Network Conditions',
      description: 'Reset network throttling to default browser conditions.',
      inputSchema: BrowserSessionCloseSchema,
    },
    async (args) => {
      try {
        const transport = requireTransport(args.sessionId);
        const unsupported = requireFeature('browser.network.reset', transport, 'network_control');
        if (unsupported) {
          return encodeResponse(unsupported, true);
        }
        await browserManager.resetNetworkConditions(args.sessionId);
        return encodeResponse({
          ...baseResult('browser.network.reset', transport.browserType, args.sessionId),
          warnings: transportWarnings('browser.network.reset', transport),
          data: { status: 'reset' },
        });
      } catch (error) {
        return encodeResponse(
          failureResult('browser.network.reset', 'browser_action_failed', error instanceof Error ? error.message : String(error), undefined, args.sessionId),
          true
        );
      }
    }
  );

  server.registerTool(
    'browser.metrics',
    {
      title: 'Get Browser Metrics',
      description: 'Collect raw browser performance metrics from a session.',
      inputSchema: BrowserMetricsSchema,
    },
    async (args) => {
      try {
        const transport = requireTransport(args.sessionId);
        if (!transport.hasCdp) {
          return encodeResponse(
            failureResult(
              'browser.metrics',
              'unsupported_browser_feature',
              `Metrics are not available for ${transport.browserType} without CDP`,
              transport.browserType,
              args.sessionId
            ),
            true
          );
        }
        const metrics = await browserManager.getMetrics(args.sessionId);
        return encodeResponse({
          ...baseResult('browser.metrics', transport.browserType, args.sessionId),
          warnings: transportWarnings('browser.metrics', transport),
          artifacts: [
            {
              kind: 'metrics',
              description: 'Browser metrics returned inline in the MCP response',
              mimeType: 'application/json',
            },
          ],
          data: metrics,
        });
      } catch (error) {
        return encodeResponse(
          failureResult('browser.metrics', 'browser_action_failed', error instanceof Error ? error.message : String(error), undefined, args.sessionId),
          true
        );
      }
    }
  );

  server.registerTool(
    'browser.web_vitals',
    {
      title: 'Get Web Vitals',
      description: 'Measure Core Web Vitals for a browser session.',
      inputSchema: BrowserMetricsSchema,
    },
    async (args) => {
      try {
        const transport = requireTransport(args.sessionId);
        const unsupported = requireFeature('browser.web_vitals', transport, 'web_vitals');
        if (unsupported) {
          return encodeResponse(unsupported, true);
        }
        const vitals = await browserManager.getWebVitals(args.sessionId);
        return encodeResponse({
          ...baseResult('browser.web_vitals', transport.browserType, args.sessionId),
          warnings: transportWarnings('browser.web_vitals', transport),
          data: vitals,
        });
      } catch (error) {
        return encodeResponse(
          failureResult('browser.web_vitals', 'browser_action_failed', error instanceof Error ? error.message : String(error), undefined, args.sessionId),
          true
        );
      }
    }
  );

  server.registerTool(
    'browser.audit.design',
    {
      title: 'Run Design Audit',
      description: 'Run a UI and accessibility design audit for the current page.',
      inputSchema: BrowserMetricsSchema,
    },
    async (args) => {
      try {
        const transport = requireTransport(args.sessionId);
        const unsupported = requireFeature('browser.audit.design', transport, 'design_audit');
        if (unsupported) {
          return encodeResponse(unsupported, true);
        }
        const audit = await browserManager.runDesignAudit(args.sessionId);
        return encodeResponse({
          ...baseResult('browser.audit.design', transport.browserType, args.sessionId),
          warnings: transportWarnings('browser.audit.design', transport),
          artifacts: [
            {
              kind: 'audit',
              description: 'Design audit returned inline in the MCP response',
              mimeType: 'application/json',
            },
          ],
          data: audit,
        });
      } catch (error) {
        return encodeResponse(
          failureResult('browser.audit.design', 'browser_action_failed', error instanceof Error ? error.message : String(error), undefined, args.sessionId),
          true
        );
      }
    }
  );

  server.registerTool(
    'browser.profile.start',
    {
      title: 'Start Browser Profile',
      description: 'Start a performance profile for the current browser session.',
      inputSchema: BrowserProfileStartSchema,
    },
    async (args) => {
      try {
        const transport = requireTransport(args.sessionId);
        const unsupported = requireFeature('browser.profile.start', transport, 'profiling');
        if (unsupported) {
          return encodeResponse(unsupported, true);
        }
        const profilingId = await browserManager.startProfiling(args.sessionId);
        return encodeResponse({
          ...baseResult('browser.profile.start', transport.browserType, args.sessionId),
          warnings: transportWarnings('browser.profile.start', transport),
          data: { profilingId },
        });
      } catch (error) {
        return encodeResponse(
          failureResult('browser.profile.start', 'browser_action_failed', error instanceof Error ? error.message : String(error), undefined, args.sessionId),
          true
        );
      }
    }
  );

  server.registerTool(
    'browser.profile.stop',
    {
      title: 'Stop Browser Profile',
      description: 'Stop a performance profile and save the result as a browser artifact.',
      inputSchema: BrowserProfileStopSchema,
    },
    async (args) => {
      try {
        const transport = requireTransport(args.sessionId);
        const unsupported = requireFeature('browser.profile.stop', transport, 'profiling');
        if (unsupported) {
          return encodeResponse(unsupported, true);
        }
        const profile = await browserManager.stopProfiling(args.sessionId, args.profilingId);
        const artifact = await writeArtifact(
          `profile_${args.sessionId}`,
          'json',
          JSON.stringify(profile, null, 2)
        );
        return encodeResponse({
          ...baseResult('browser.profile.stop', transport.browserType, args.sessionId),
          warnings: transportWarnings('browser.profile.stop', transport),
          artifacts: [artifact],
          data: {
            profilingId: args.profilingId,
            method: profile.method,
            metricsCount: profile.metrics.length,
          },
        });
      } catch (error) {
        return encodeResponse(
          failureResult('browser.profile.stop', 'profile_not_found', error instanceof Error ? error.message : String(error), undefined, args.sessionId),
          true
        );
      }
    }
  );

  server.registerTool(
    'browser.evidence.capture',
    {
      title: 'Capture Evidence Capsule',
      description: 'Capture a comprehensive browser evidence snapshot for debugging failures. Collects screenshots, console logs, network requests, and performance metrics.',
      inputSchema: BrowserEvidenceCaptureSchema,
    },
    async (args) => {
      try {
        const collector = getEvidenceCapsuleCollector();
        const capsule = await collector.capture({
          type: args.failureType,
          message: args.failureMessage,
          ...(args.failureStack !== undefined ? { stack: args.failureStack } : {}),
        });

        return encodeResponse({
          ...baseResult('browser.evidence.capture'),
          data: {
            capsuleId: capsule.capsuleId,
            timestamp: capsule.timestamp,
            failureType: capsule.failure.type,
            screenshotCount: capsule.browser.screenshots.length,
            consoleErrorCount: capsule.browser.console.errors.length,
            consoleWarningCount: capsule.browser.console.warnings.length,
            networkRequestCount: capsule.browser.networkRequests.length,
            hasSessionMetadata: capsule.browser.sessionMetadata.url !== '',
          },
          capsule,
        });
      } catch (error) {
        return encodeResponse(
          failureResult('browser.evidence.capture', 'browser_action_failed', error instanceof Error ? error.message : String(error)),
          true
        );
      }
    }
  );

  server.registerTool(
    'browser.evidence.explain',
    {
      title: 'Explain Evidence Capsule',
      description: 'Analyze an evidence capsule and generate a structured failure explanation with root cause classification.',
      inputSchema: BrowserEvidenceExplainSchema,
    },
    async (args) => {
      try {
        const collector = getEvidenceCapsuleCollector();
        const capsule = collector.get(args.capsuleId);

        if (!capsule) {
          return encodeResponse(
            failureResult('browser.evidence.explain', 'capsule_not_found', `Evidence capsule '${args.capsuleId}' not found`),
            true
          );
        }

        const classifier = getFailureClassifier();
        const explanation = classifier.classify(capsule);

        return encodeResponse({
          ...baseResult('browser.evidence.explain'),
          data: {
            capsuleId: args.capsuleId,
            explanation,
          },
        });
      } catch (error) {
        return encodeResponse(
          failureResult('browser.evidence.explain', 'browser_action_failed', error instanceof Error ? error.message : String(error)),
          true
        );
      }
    }
  );

  // ===========================================================================
  // Assertion Evaluation Tool
  // ===========================================================================

  server.registerTool(
    'browser.assertions.evaluate',
    {
      title: 'Evaluate Assertions',
      description: 'Evaluate assertions for an evidence capsule. Runs functional, visual, accessibility, performance, UX, and network checks against the captured evidence.',
      inputSchema: BrowserAssertionsEvaluateSchema,
    },
    async (args) => {
      try {
        const collector = getEvidenceCapsuleCollector();
        const capsule = collector.get(args.capsuleId);

        if (!capsule) {
          return encodeResponse(
            failureResult(
              'browser.assertions.evaluate',
              'session_not_found',
              `Evidence capsule with ID '${args.capsuleId}' not found`
            ),
            true
          );
        }

        const evaluator = getAssertionEvaluator();
        const result = evaluator.evaluate(capsule);

        return encodeResponse({
          ...baseResult('browser.assertions.evaluate'),
          data: {
            capsuleId: result.capsuleId,
            timestamp: result.timestamp,
            totalChecks: result.totalChecks,
            passed: result.passed,
            failed: result.failed,
            summary: {
              functional: result.assertions
                .filter((a) => a.category === 'functional')
                .map((a) => ({ description: a.description, passed: a.passed, severity: a.severity })),
              visual: result.assertions
                .filter((a) => a.category === 'visual')
                .map((a) => ({ description: a.description, passed: a.passed, severity: a.severity })),
              accessibility: result.assertions
                .filter((a) => a.category === 'accessibility')
                .map((a) => ({ description: a.description, passed: a.passed, severity: a.severity })),
              performance: result.assertions
                .filter((a) => a.category === 'performance')
                .map((a) => ({ description: a.description, passed: a.passed, severity: a.severity })),
              ux: result.assertions
                .filter((a) => a.category === 'ux')
                .map((a) => ({ description: a.description, passed: a.passed, severity: a.severity })),
              network: result.assertions
                .filter((a) => a.category === 'network')
                .map((a) => ({ description: a.description, passed: a.passed, severity: a.severity })),
            },
          },
          assertions: result.assertions,
        });
      } catch (error) {
        return encodeResponse(
          failureResult('browser.assertions.evaluate', 'browser_action_failed', error instanceof Error ? error.message : String(error)),
          true
        );
      }
    }
  );

  // ===========================================================================
  // Fix Verification Tool
  // ===========================================================================

  server.registerTool(
    'browser.verification.run',
    {
      title: 'Run Fix Verification',
      description: 'Verify a fix by running multiple assertion evaluations against an original failure. Determines if the issue is fixed, still failing, flaky, or inconclusive.',
      inputSchema: BrowserVerificationRunSchema,
    },
    async (args) => {
      try {
        const collector = getEvidenceCapsuleCollector();
        const capsule = collector.get(args.originalCapsuleId);

        if (!capsule) {
          return encodeResponse(
            failureResult(
              'browser.verification.run',
              'capsule_not_found',
              `Original evidence capsule '${args.originalCapsuleId}' not found`
            ),
            true
          );
        }

        const verifier = getFixVerifier();
        const rerunCount = args.rerunCount ?? 3;
        const result = await verifier.verify(args.patchId, args.originalCapsuleId, rerunCount);

        return encodeResponse({
          ...baseResult('browser.verification.run'),
          data: {
            patchId: result.patchId,
            originalFailure: result.originalFailure,
            reruns: result.reruns.map((r) => ({
              runIndex: r.runIndex,
              capsuleId: r.capsuleId,
              timestamp: r.timestamp,
              totalChecks: r.assertions.totalChecks,
              passed: r.assertions.passed,
              failed: r.assertions.failed,
            })),
            overallVerdict: result.overallVerdict,
            summary: result.summary,
          },
          verification: result,
        });
      } catch (error) {
        return encodeResponse(
          failureResult('browser.verification.run', 'browser_action_failed', error instanceof Error ? error.message : String(error)),
          true
        );
      }
    }
  );

  // ===========================================================================
  // Flake Analysis Tool
  // ===========================================================================

  server.registerTool(
    'browser.evidence.analyze_flake',
    {
      title: 'Analyze Flake Patterns',
      description: 'Analyze multiple evidence capsules to detect flaky test/failure patterns. Identifies intermittent failures, determines root cause classification, and provides actionable recommendations.',
      inputSchema: BrowserFlakeAnalysisSchema,
    },
    async (args) => {
      try {
        const collector = getEvidenceCapsuleCollector();
        const missingCapsules: string[] = [];

        // Validate that all capsules exist
        for (const capsuleId of args.capsuleIds) {
          const capsule = collector.get(capsuleId);
          if (!capsule) {
            missingCapsules.push(capsuleId);
          }
        }

        if (missingCapsules.length > 0) {
          return encodeResponse(
            failureResult(
              'browser.evidence.analyze_flake',
              'capsule_not_found',
              `Evidence capsules not found: ${missingCapsules.join(', ')}`
            ),
            true
          );
        }

        const analyzer = getFlakeAnalyzer();
        const result = await analyzer.analyze(args.capsuleIds);

        return encodeResponse({
          ...baseResult('browser.evidence.analyze_flake'),
          data: {
            capsuleIds: result.capsuleIds,
            failureClass: result.failureClass,
            isFlaky: result.isFlaky,
            confidence: result.confidence,
            recommendedAction: result.recommendedAction,
            reasoning: result.reasoning,
            historicalFrequency: result.historicalFrequency,
            patternSignature: result.patternSignature,
          },
          analysis: result,
        });
      } catch (error) {
        return encodeResponse(
          failureResult('browser.evidence.analyze_flake', 'browser_action_failed', error instanceof Error ? error.message : String(error)),
          true
        );
      }
    }
  );

  // ===========================================================================
  // Root Cause Mapping Tool
  // ===========================================================================

  server.registerTool(
    'browser.evidence.root_cause',
    {
      title: 'Get Root Cause Mapping',
      description: 'Map an evidence capsule to actionable root cause insights. Identifies likely UI component, event handler, API call, and generates candidate fixes based on failure classification.',
      inputSchema: BrowserEvidenceRootCauseSchema,
    },
    async (args) => {
      try {
        const collector = getEvidenceCapsuleCollector();
        const capsule = collector.get(args.capsuleId);

        if (!capsule) {
          return encodeResponse(
            failureResult(
              'browser.evidence.root_cause',
              'capsule_not_found',
              `Evidence capsule '${args.capsuleId}' not found`
            ),
            true
          );
        }

        const mapper = getRootCauseMapper();
        const mapping = await mapper.map(args.capsuleId);

        return encodeResponse({
          ...baseResult('browser.evidence.root_cause'),
          data: {
            capsuleId: mapping.capsuleId,
            failureClass: mapping.failureExplanation.failureClass,
            confidence: mapping.failureExplanation.confidence,
            likelyComponent: mapping.likelyComponent,
            likelyHandler: mapping.likelyHandler,
            likelyApiCall: mapping.likelyApiCall,
            candidateFixes: mapping.candidateFixes.map((fix) => ({
              description: fix.description,
              confidence: fix.confidence,
              category: fix.category,
            })),
            timestamp: mapping.timestamp,
          },
          mapping,
        });
      } catch (error) {
        return encodeResponse(
          failureResult('browser.evidence.root_cause', 'browser_action_failed', error instanceof Error ? error.message : String(error)),
          true
        );
      }
    }
  );

  // ===========================================================================
  // Workflow Recorder Tools
  // ===========================================================================

  server.registerTool(
    'browser.recorder.start',
    {
      title: 'Start Recording Workflow',
      description: 'Start recording browser actions for test generation. Returns a workflowId that can be used to stop recording or export the generated test code.',
      inputSchema: BrowserRecorderStartSchema,
    },
    async (args) => {
      try {
        const recorder = getWorkflowRecorder();
        const workflowId = recorder.startRecording(args.name);

        return encodeResponse({
          ...baseResult('browser.recorder.start'),
          data: {
            workflowId,
            name: args.name,
            status: 'recording',
          },
        });
      } catch (error) {
        return encodeResponse(
          failureResult('browser.recorder.start', 'browser_action_failed', error instanceof Error ? error.message : String(error)),
          true
        );
      }
    }
  );

  server.registerTool(
    'browser.recorder.stop',
    {
      title: 'Stop Recording Workflow',
      description: 'Stop a workflow recording session and return the recorded workflow with generated test code and assertions.',
      inputSchema: BrowserRecorderStopSchema,
    },
    async (args) => {
      try {
        const recorder = getWorkflowRecorder();
        const workflow = recorder.stopRecording(args.workflowId);

        return encodeResponse({
          ...baseResult('browser.recorder.stop'),
          data: {
            workflowId: workflow.id,
            name: workflow.name,
            startedAt: workflow.startedAt,
            endedAt: workflow.endedAt,
            actionCount: workflow.actions.length,
            generatedCode: workflow.generatedCode,
            generatedAssertions: workflow.generatedAssertions,
          },
          workflow,
        });
      } catch (error) {
        return encodeResponse(
          failureResult('browser.recorder.stop', 'browser_action_failed', error instanceof Error ? error.message : String(error)),
          true
        );
      }
    }
  );

  server.registerTool(
    'browser.recorder.export',
    {
      title: 'Export Recorded Workflow',
      description: 'Export the generated test code and assertions for a recorded workflow without stopping it.',
      inputSchema: BrowserRecorderExportSchema,
    },
    async (args) => {
      try {
        const recorder = getWorkflowRecorder();
        const workflow = recorder.getWorkflow(args.workflowId);

        if (!workflow) {
          return encodeResponse(
            failureResult(
              'browser.recorder.export',
              'session_not_found',
              `Workflow '${args.workflowId}' not found`
            ),
            true
          );
        }

        const generatedCode = recorder.generateCode(args.workflowId);
        const generatedAssertions = recorder.generateAssertions(args.workflowId);

        return encodeResponse({
          ...baseResult('browser.recorder.export'),
          data: {
            workflowId: workflow.id,
            name: workflow.name,
            generatedCode,
            generatedAssertions,
            actionCount: workflow.actions.length,
          },
        });
      } catch (error) {
        return encodeResponse(
          failureResult('browser.recorder.export', 'browser_action_failed', error instanceof Error ? error.message : String(error)),
          true
        );
      }
    }
  );

  // ===========================================================================
  // PR Summary Tool
  // ===========================================================================

  server.registerTool(
    'browser.pr_summary.generate',
    {
      title: 'Generate PR Summary',
      description: 'Generate a comprehensive PR summary from an evidence capsule for CI/CD workflow integration. Includes reproduction steps, evidence summary, root cause analysis, suggested fixes, and verification status.',
      inputSchema: BrowserPRSummaryGenerateSchema,
    },
    async (args) => {
      try {
        const collector = getEvidenceCapsuleCollector();
        const capsule = collector.get(args.capsuleId);

        if (!capsule) {
          return encodeResponse(
            failureResult(
              'browser.pr_summary.generate',
              'capsule_not_found',
              `Evidence capsule '${args.capsuleId}' not found`
            ),
            true
          );
        }

        const generator = getPRSummaryGenerator();
        const summary = await generator.generate(args.capsuleId);

        return encodeResponse({
          ...baseResult('browser.pr_summary.generate'),
          data: {
            summaryId: summary.id,
            capsuleId: summary.capsuleId,
            generatedAt: summary.generatedAt,
            failureClass: summary.probableRootCause.failureExplanation.failureClass,
            confidence: summary.probableRootCause.failureExplanation.confidence,
            likelyComponent: summary.probableRootCause.likelyComponent,
            likelyHandler: summary.probableRootCause.likelyHandler,
            likelyApiCall: summary.probableRootCause.likelyApiCall,
            suggestedFix: summary.suggestedFix,
            hasVerification: summary.verification !== null,
            verificationVerdict: summary.verification?.overallVerdict ?? null,
          },
          summary: {
            repro: summary.repro,
            evidenceSummary: summary.evidenceSummary,
            markdown: summary.markdown,
            machineReadable: summary.machineReadable,
          },
        });
      } catch (error) {
        return encodeResponse(
          failureResult(
            'browser.pr_summary.generate',
            'browser_action_failed',
            error instanceof Error ? error.message : String(error)
          ),
          true
        );
      }
    }
  );

  logger.info('browser.* public tools registered');
}
