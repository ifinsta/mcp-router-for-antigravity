/**
 * Testing Tool Handlers
 *
 * MCP tools for master testing system that controls browsers
 * and works with source code to ensure comprehensive software testing.
 * All browser operations are routed through the Chrome extension bridge.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { writeFile, mkdir } from 'node:fs/promises';
import { resolve as pathResolve } from 'node:path';
import { getLogger } from '../infra/logger.js';
import { getBrowserManager } from '../browser/browserManager.js';
import { BrowserType } from '../browser/browserManager.js';
import type { BrowserConfig } from '../browser/browserManager.js';
import { getExtensionBridge } from '../browser/extensionBridge.js';
import { runOrchestration } from '../testing/orchestrator.js';
import type { TestProfile } from '../testing/orchestrator.js';

const logger = getLogger('testing-tool-handlers');

/**
 * Generate unique request ID
 */
function generateRequestId(): string {
  return `test_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

function routerErrorResponse(error: unknown) {
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(
          {
            error: true,
            message: error instanceof Error ? error.message : String(error),
          },
          null,
          2
        ),
      },
    ],
    isError: true,
  };
}

// ============================================================================
// Input Schemas
// ============================================================================

const TestLaunchBrowserSchema = z.object({
  browserType: z.enum(['chrome', 'firefox', 'safari', 'edge']).describe('Browser type to launch'),
  headless: z.boolean().default(true).describe('Run browser in headless mode'),
  url: z.string().optional().describe('Initial URL to navigate to'),
  viewport: z.object({
    width: z.number().optional(),
    height: z.number().optional(),
    deviceScaleFactor: z.number().optional(),
  }).optional().describe('Viewport configuration'),
  userAgent: z.string().optional().describe('Custom user agent string'),
  locale: z.string().optional().describe('Browser locale'),
  timezone: z.string().optional().describe('Browser timezone'),
});

const TestNavigateSchema = z.object({
  sessionId: z.string().describe('Browser session ID'),
  url: z.string().describe('URL to navigate to'),
  waitFor: z.enum(['load', 'networkidle', 'selector']).default('networkidle').describe('Wait condition'),
  timeout: z.number().int().positive().optional().default(30000).describe('Navigation timeout in milliseconds'),
  selector: z.string().optional().describe('CSS selector to wait for'),
});

const TestScreenshotSchema = z.object({
  sessionId: z.string().describe('Browser session ID'),
  fullPage: z.boolean().default(false).describe('Capture full page screenshot'),
  selector: z.string().optional().describe('CSS selector to screenshot'),
  encoding: z.enum(['base64', 'binary']).default('base64').describe('Screenshot encoding'),
  type: z.enum(['png', 'jpeg']).default('png').describe('Screenshot type'),
  quality: z.number().int().min(0).max(100).optional().default(80).describe('Screenshot quality (0-100)'),
});

const TestExecuteScriptSchema = z.object({
  sessionId: z.string().describe('Browser session ID'),
  script: z.string().describe('JavaScript to execute in browser context'),
  timeout: z.number().int().positive().optional().default(10000).describe('Script execution timeout in milliseconds'),
});

const TestCloseSessionSchema = z.object({
  sessionId: z.string().describe('Browser session ID'),
  cleanup: z.boolean().default(true).describe('Clean up resources and close browser'),
});

const TestListSessionsSchema = z.object({
  active: z.boolean().default(true).describe('List only active sessions'),
});

const TestRunAllTestsSchema = z.object({
  repositoryUrl: z.string().describe('Git repository URL'),
  branch: z.string().optional().describe('Branch to test (default: main)'),
  testTypes: z.array(z.enum(['unit', 'integration', 'e2e', 'performance'])).default(['performance']).describe('Test types to run'),
  parallel: z.boolean().default(true).describe('Run tests in parallel'),
  browsers: z.array(z.enum(['chrome', 'firefox', 'safari', 'edge'])).default(['chrome']).describe('Browsers to test on'),
  headless: z.boolean().default(true).describe('Run browsers in headless mode'),
});

// ============================================================================
// Tool Registration Functions
// ============================================================================

/**
 * Register test_launch_browser tool
 */
export function registerTestLaunchBrowserTool(server: McpServer): void {
  server.registerTool(
    'test_launch_browser',
    {
      title: 'Testing: Launch Browser',
      description: 'Launch a browser instance with the MCP test extension. Supports Chrome (via extension bridge). Firefox, Safari, and Edge are not yet implemented.',
      inputSchema: TestLaunchBrowserSchema,
    },
    async (args) => {
      const requestId = generateRequestId();
      logger.info('test_launch_browser tool called', { requestId, ...args });

      try {
        const bridge = getExtensionBridge();
        const browserManager = getBrowserManager();

        // Start the WebSocket server if not already running
        if (!bridge.isRunning()) {
          logger.info('Starting extension bridge WebSocket server');
          await bridge.startServer();
        }

        const config: BrowserConfig = {
          type: args.browserType as BrowserConfig['type'],
          headless: args.headless,
          ...(args.viewport !== undefined ? {
            viewport: {
              width: args.viewport.width ?? 1280,
              height: args.viewport.height ?? 720,
              ...(args.viewport.deviceScaleFactor !== undefined ? { deviceScaleFactor: args.viewport.deviceScaleFactor } : {}),
            },
          } : {}),
          ...(args.userAgent !== undefined ? { userAgent: args.userAgent } : {}),
          ...(args.locale !== undefined ? { locale: args.locale } : {}),
          ...(args.timezone !== undefined ? { timezone: args.timezone } : {}),
          permissions: [],
        };

        const sessionId = await browserManager.launchBrowser(config);
        const session = browserManager.getSession(sessionId);
        const extensionId = session?.extensionId ?? null;

        // If an initial URL was provided, navigate to it
        let navigationResult = null;
        if (args.url !== undefined) {
          navigationResult = await browserManager.navigate(sessionId, args.url);
        }

        logger.info('test_launch_browser tool completed', { requestId, sessionId, extensionId });

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  requestId,
                  sessionId,
                  extensionId,
                  browserType: args.browserType,
                  headless: args.headless,
                  status: 'launched',
                  ...(navigationResult !== null ? { navigation: navigationResult } : {}),
                  resourceUsage: browserManager.getResourceUsage(),
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        logger.error('test_launch_browser tool failed', error instanceof Error ? error : new Error(String(error)), { requestId });
        return routerErrorResponse(error);
      }
    }
  );

  logger.info('test_launch_browser tool registered');
}

/**
 * Register test_navigate tool
 */
export function registerTestNavigateTool(server: McpServer): void {
  server.registerTool(
    'test_navigate',
    {
      title: 'Testing: Navigate to URL',
      description: 'Navigate to a URL in the specified browser session. Supports various wait conditions and timeout handling.',
      inputSchema: TestNavigateSchema,
    },
    async (args) => {
      const requestId = generateRequestId();
      logger.info('test_navigate tool called', { requestId, ...args });

      try {
        const browserManager = getBrowserManager();
        const session = browserManager.getSession(args.sessionId);

        if (!session || !session.isActive) {
          return routerErrorResponse(
            new Error(`Session '${args.sessionId}' not found or inactive. Run test_launch_browser first.`)
          );
        }

        const result = await browserManager.navigate(args.sessionId, args.url, {
          waitFor: args.waitFor,
          timeout: args.timeout,
        });

        logger.info('test_navigate tool completed', { requestId, url: result.url, loadTime: result.loadTime });

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  requestId,
                  ...result,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        logger.error('test_navigate tool failed', error instanceof Error ? error : new Error(String(error)), { requestId });
        return routerErrorResponse(error);
      }
    }
  );

  logger.info('test_navigate tool registered');
}

/**
 * Register test_screenshot tool
 */
export function registerTestScreenshotTool(server: McpServer): void {
  server.registerTool(
    'test_screenshot',
    {
      title: 'Testing: Take Screenshot',
      description: 'Capture screenshots in the specified browser session. Saves the screenshot to screenshots/ directory and returns the file path.',
      inputSchema: TestScreenshotSchema,
    },
    async (args) => {
      const requestId = generateRequestId();
      logger.info('test_screenshot tool called', { requestId, ...args });

      try {
        const browserManager = getBrowserManager();
        const session = browserManager.getSession(args.sessionId);

        if (!session || !session.isActive) {
          return routerErrorResponse(
            new Error(`Session '${args.sessionId}' not found or inactive. Run test_launch_browser first.`)
          );
        }

        const base64Data = await browserManager.takeScreenshot(args.sessionId, {
          fullPage: args.fullPage,
          ...(args.selector !== undefined ? { selector: args.selector } : {}),
          encoding: args.encoding,
          type: args.type,
          quality: args.quality,
        });

        // Save to screenshots/ directory
        const screenshotsDir = pathResolve(process.cwd(), 'screenshots');
        await mkdir(screenshotsDir, { recursive: true });

        const ext = args.type === 'jpeg' ? 'jpg' : 'png';
        const filename = `screenshot_${args.sessionId}_${Date.now()}.${ext}`;
        const filepath = pathResolve(screenshotsDir, filename);

        await writeFile(filepath, Buffer.from(base64Data, 'base64'));

        logger.info('test_screenshot tool completed', { requestId, filepath, size: base64Data.length });

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  requestId,
                  sessionId: args.sessionId,
                  filepath,
                  filename,
                  format: args.type,
                  size: base64Data.length,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        logger.error('test_screenshot tool failed', error instanceof Error ? error : new Error(String(error)), { requestId });
        return routerErrorResponse(error);
      }
    }
  );

  logger.info('test_screenshot tool registered');
}

/**
 * Register test_execute_script tool
 */
export function registerTestExecuteScriptTool(server: McpServer): void {
  server.registerTool(
    'test_execute_script',
    {
      title: 'Testing: Execute Script',
      description: 'Execute JavaScript code in the browser context. Useful for DOM manipulation, form filling, and other in-page operations.',
      inputSchema: TestExecuteScriptSchema,
    },
    async (args) => {
      const requestId = generateRequestId();
      logger.info('test_execute_script tool called', { requestId, scriptLength: args.script.length });

      try {
        const browserManager = getBrowserManager();
        const session = browserManager.getSession(args.sessionId);

        if (!session || !session.isActive) {
          return routerErrorResponse(
            new Error(`Session '${args.sessionId}' not found or inactive. Run test_launch_browser first.`)
          );
        }

        const result = await browserManager.executeScript(args.sessionId, args.script);

        logger.info('test_execute_script tool completed', { requestId });

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  requestId,
                  sessionId: args.sessionId,
                  result,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        logger.error('test_execute_script tool failed', error instanceof Error ? error : new Error(String(error)), { requestId });
        return routerErrorResponse(error);
      }
    }
  );

  logger.info('test_execute_script tool registered');
}

/**
 * Register test_close_session tool
 */
export function registerTestCloseSessionTool(server: McpServer): void {
  server.registerTool(
    'test_close_session',
    {
      title: 'Testing: Close Browser Session',
      description: 'Close a browser session and clean up resources. Kills the Chrome process and disconnects the extension.',
      inputSchema: TestCloseSessionSchema,
    },
    async (args) => {
      const requestId = generateRequestId();
      logger.info('test_close_session tool called', { requestId, ...args });

      try {
        const browserManager = getBrowserManager();
        await browserManager.closeSession(args.sessionId);

        logger.info('test_close_session tool completed', { requestId });

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  requestId,
                  sessionId: args.sessionId,
                  status: 'closed',
                  resourceUsage: browserManager.getResourceUsage(),
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        logger.error('test_close_session tool failed', error instanceof Error ? error : new Error(String(error)), { requestId });
        return routerErrorResponse(error);
      }
    }
  );

  logger.info('test_close_session tool registered');
}

/**
 * Register test_list_sessions tool
 */
export function registerTestListSessionsTool(server: McpServer): void {
  server.registerTool(
    'test_list_sessions',
    {
      title: 'Testing: List Browser Sessions',
      description: 'List all active browser sessions with their configuration, status, and extension connection info.',
      inputSchema: TestListSessionsSchema,
    },
    async (args) => {
      const requestId = generateRequestId();
      logger.info('test_list_sessions tool called', { requestId });

      try {
        const browserManager = getBrowserManager();
        const bridge = getExtensionBridge();

        const sessions = browserManager.getActiveSessions();
        const connectedExtensions = bridge.getConnectedExtensions();
        const resourceUsage = browserManager.getResourceUsage();

        // Query extension for active tabs if any extension is connected
        let extensionTabs: unknown[] = [];
        const firstExtension = connectedExtensions[0];
        if (firstExtension !== undefined) {
          try {
            const tabResult = await bridge.sendCommand(firstExtension, 'listTabs', {}) as Record<string, unknown>;
            const tabs = tabResult['tabs'];
            if (Array.isArray(tabs)) {
              extensionTabs = tabs;
            }
          } catch (err) {
            logger.warn('Failed to query extension tabs', {
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }

        logger.info('test_list_sessions tool completed', { requestId, sessionCount: sessions.length });

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  requestId,
                  sessions: sessions.map(session => ({
                    sessionId: session.sessionId,
                    browserType: session.browserType,
                    isActive: session.isActive,
                    createdAt: session.createdAt,
                    lastActivity: session.lastActivity,
                    ...(session.extensionId !== undefined ? { extensionId: session.extensionId } : {}),
                  })),
                  connectedExtensions,
                  extensionTabs,
                  resourceUsage,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        logger.error('test_list_sessions tool failed', error instanceof Error ? error : new Error(String(error)), { requestId });
        return routerErrorResponse(error);
      }
    }
  );

  logger.info('test_list_sessions tool registered');
}

/**
 * Register test_run_all_tests tool
 */
export function registerTestRunAllTestsTool(server: McpServer): void {
  server.registerTool(
    'test_run_all_tests',
    {
      title: 'Testing: Run All Tests',
      description: 'Run comprehensive test suite on source code repository. Supports unit, integration, e2e, and performance testing across multiple browsers.',
      inputSchema: TestRunAllTestsSchema,
    },
    async (args) => {
      const requestId = generateRequestId();
      logger.info('test_run_all_tests tool called', { requestId, ...args });

      try {
        const browserManager = getBrowserManager();
        const bridge = getExtensionBridge();

        // Start WebSocket server if needed
        if (!bridge.isRunning()) {
          await bridge.startServer();
        }

        // Launch browsers for testing
        const sessions: Array<{ browserType: string; sessionId: string }> = [];
        for (const browserType of args.browsers) {
          const config: BrowserConfig = {
            type: browserType as BrowserConfig['type'],
            headless: args.headless,
            viewport: { width: 1920, height: 1080 },
          };

          const sessionId = await browserManager.launchBrowser(config);
          sessions.push({ browserType, sessionId });
        }

        // Navigate to repository URL
        for (const session of sessions) {
          await browserManager.navigate(session.sessionId, args.repositoryUrl);
        }

        // Execute tests based on test types
        const testResults: Array<Record<string, unknown>> = [];

        for (const testType of args.testTypes) {
          if (testType === 'performance') {
            for (const session of sessions) {
              try {
                const metrics = await browserManager.getMetrics(session.sessionId);
                const webVitals = await browserManager.getWebVitals(session.sessionId);
                testResults.push({
                  testType: 'performance',
                  browserType: session.browserType,
                  sessionId: session.sessionId,
                  status: 'completed',
                  metrics,
                  webVitals,
                  timestamp: Date.now(),
                });
              } catch (err) {
                testResults.push({
                  testType: 'performance',
                  browserType: session.browserType,
                  sessionId: session.sessionId,
                  status: 'failed',
                  error: err instanceof Error ? err.message : String(err),
                  timestamp: Date.now(),
                });
              }
            }
          } else {
            testResults.push({
              testType,
              status: 'not_implemented',
              message: `${testType} testing requires framework-specific integration`,
            });
          }
        }

        // Cleanup sessions
        for (const session of sessions) {
          await browserManager.closeSession(session.sessionId);
        }

        logger.info('test_run_all_tests tool completed', { requestId, testCount: testResults.length });

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  requestId,
                  repositoryUrl: args.repositoryUrl,
                  branch: args.branch ?? 'main',
                  testTypes: args.testTypes,
                  browsers: args.browsers,
                  parallel: args.parallel,
                  results: testResults,
                  summary: {
                    totalTests: testResults.length,
                    passed: testResults.filter(r => r['status'] === 'completed').length,
                    failed: testResults.filter(r => r['status'] === 'failed').length,
                    notImplemented: testResults.filter(r => r['status'] === 'not_implemented').length,
                  },
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        logger.error('test_run_all_tests tool failed', error instanceof Error ? error : new Error(String(error)), { requestId });
        return routerErrorResponse(error);
      }
    }
  );

  logger.info('test_run_all_tests tool registered');
}

// ============================================================================
// Orchestration Tools
// ============================================================================

const TestRunAutomatedSchema = z.object({
  url: z.string().describe('URL to test'),
  profile: z.enum(['quick', 'standard', 'comprehensive']).default('standard').describe('Test profile: quick (vitals+screenshot), standard (+ design audit + perf), comprehensive (+ network + accessibility across 3 viewports)'),
  viewports: z.array(z.object({
    label: z.string(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  })).optional().describe('Custom viewport list (overrides profile defaults)'),
  timeout: z.number().int().positive().optional().describe('Overall timeout in milliseconds'),
});

/**
 * Register test_run_automated tool
 */
export function registerTestRunAutomatedTool(server: McpServer): void {
  server.registerTool(
    'test_run_automated',
    {
      title: 'Testing: Run Automated Pipeline',
      description: 'Run a hands-free automated test pipeline on a URL. Launches Chrome with the extension, measures Web Vitals, takes screenshots, runs design/accessibility audits, and generates a report with recommendations. Profiles: quick (1 viewport), standard (2 viewports + design audit + profiling), comprehensive (3 viewports + network + accessibility).',
      inputSchema: TestRunAutomatedSchema,
    },
    async (args) => {
      const requestId = generateRequestId();
      logger.info('test_run_automated tool called', { requestId, url: args.url, profile: args.profile });

      try {
        const report = await runOrchestration({
          url: args.url,
          profile: args.profile as TestProfile,
          ...(args.viewports !== undefined ? { viewports: args.viewports } : {}),
          ...(args.timeout !== undefined ? { timeout: args.timeout } : {}),
        });

        logger.info('test_run_automated tool completed', {
          requestId,
          verdict: report.overallVerdict,
          passed: report.summary.passed,
          failed: report.summary.failed,
        });

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  requestId,
                  ...report,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        logger.error('test_run_automated tool failed', error instanceof Error ? error : new Error(String(error)), { requestId });
        return routerErrorResponse(error);
      }
    }
  );

  logger.info('test_run_automated tool registered');
}

const TestOpenDashboardSchema = z.object({
  url: z.string().optional().describe('Optional URL to navigate to after launching'),
});

const TestClickSchema = z.object({
  selector: z.string().describe('CSS selector for the element to click'),
  sessionId: z.string().optional().describe('Browser session ID (uses active session if not provided)'),
  waitAfter: z.number().optional().describe('Milliseconds to wait after click'),
});

const TestTypeSchema = z.object({
  selector: z.string().describe('CSS selector for the input element'),
  text: z.string().describe('Text to type'),
  sessionId: z.string().optional().describe('Browser session ID (uses active session if not provided)'),
  clearFirst: z.boolean().optional().default(true).describe('Clear existing text before typing'),
  pressEnter: z.boolean().optional().default(false).describe('Press Enter after typing'),
});

const TestFillFormSchema = z.object({
  fields: z.array(z.object({
    selector: z.string().describe('CSS selector for the field'),
    value: z.string().describe('Value to enter'),
    type: z.enum(['text', 'select', 'checkbox', 'radio', 'click']).describe('Field type'),
  })).describe('Array of form fields to fill'),
  sessionId: z.string().optional().describe('Browser session ID (uses active session if not provided)'),
});

const TestHoverSchema = z.object({
  selector: z.string().describe('CSS selector for the element to hover'),
  sessionId: z.string().optional().describe('Browser session ID (uses active session if not provided)'),
});

const TestWaitForSchema = z.object({
  selector: z.string().describe('CSS selector for the element to wait for'),
  timeout: z.number().optional().default(10000).describe('Timeout in milliseconds'),
  sessionId: z.string().optional().describe('Browser session ID (uses active session if not provided)'),
});

/**
 * Register test_open_dashboard tool
 */
export function registerTestOpenDashboardTool(server: McpServer): void {
  server.registerTool(
    'test_open_dashboard',
    {
      title: 'Testing: Open Dashboard',
      description: 'Launch Chrome with the MCP test extension and open the side-panel dashboard. Optionally navigates to a URL. Returns session info for further interaction.',
      inputSchema: TestOpenDashboardSchema,
    },
    async (args) => {
      const requestId = generateRequestId();
      logger.info('test_open_dashboard tool called', { requestId, url: args.url });

      try {
        const bridge = getExtensionBridge();
        const browserManager = getBrowserManager();

        // Start WebSocket server if needed
        if (!bridge.isRunning()) {
          await bridge.startServer();
        }

        const config: BrowserConfig = {
          type: BrowserType.CHROME,
          headless: false,
          viewport: { width: 1440, height: 900 },
        };

        const sessionId = await browserManager.launchBrowser(config);
        const session = browserManager.getSession(sessionId);
        const extensionId = session?.extensionId ?? null;

        let navigationResult = null;
        if (args.url !== undefined) {
          navigationResult = await browserManager.navigate(sessionId, args.url);
        }

        logger.info('test_open_dashboard tool completed', { requestId, sessionId, extensionId });

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  requestId,
                  sessionId,
                  extensionId,
                  status: 'dashboard_opened',
                  message: 'Chrome launched with extension. Open the side panel to view the dashboard.',
                  ...(navigationResult !== null ? { navigation: navigationResult } : {}),
                  connectedExtensions: bridge.getConnectedExtensions(),
                  resourceUsage: browserManager.getResourceUsage(),
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        logger.error('test_open_dashboard tool failed', error instanceof Error ? error : new Error(String(error)), { requestId });
        return routerErrorResponse(error);
      }
    }
  );

  logger.info('test_open_dashboard tool registered');
}

/**
 * Register test_click tool
 */
export function registerTestClickTool(server: McpServer): void {
  server.registerTool(
    'test_click',
    {
      title: 'Testing: Click Element',
      description: 'Click an element on the page with visual feedback. The virtual cursor moves to the element, highlights it, and performs the click.',
      inputSchema: TestClickSchema,
    },
    async (args) => {
      const requestId = generateRequestId();
      logger.info('test_click tool called', { requestId, selector: args.selector });

      try {
        const browserManager = getBrowserManager();
        const bridge = getExtensionBridge();

        // Get session
        let sessionId = args.sessionId;
        if (!sessionId) {
          const sessions = browserManager.getActiveSessions();
          if (sessions.length === 0) {
            return routerErrorResponse(new Error('No active browser session. Run test_launch_browser or test_open_dashboard first.'));
          }
          const firstSession = sessions[0];
          if (!firstSession) {
            return routerErrorResponse(new Error('No active browser session found.'));
          }
          sessionId = firstSession.sessionId;
        }

        const session = browserManager.getSession(sessionId);
        if (!session || !session.isActive) {
          return routerErrorResponse(new Error(`Session '${sessionId}' not found or inactive.`));
        }

        if (!session.extensionId) {
          return routerErrorResponse(new Error('No extension connected to this session.'));
        }

        const result = await bridge.sendCommand(session.extensionId, 'clickElement', {
          selector: args.selector,
          waitAfter: args.waitAfter,
        }) as Record<string, unknown>;

        logger.info('test_click tool completed', { requestId, selector: args.selector });

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ requestId, result }, null, 2),
            },
          ],
        };
      } catch (error) {
        logger.error('test_click tool failed', error instanceof Error ? error : new Error(String(error)), { requestId });
        return routerErrorResponse(error);
      }
    }
  );

  logger.info('test_click tool registered');
}

/**
 * Register test_type tool
 */
export function registerTestTypeTool(server: McpServer): void {
  server.registerTool(
    'test_type',
    {
      title: 'Testing: Type Text',
      description: 'Type text into an input field with visual feedback. Simulates realistic typing with variable delays between keystrokes.',
      inputSchema: TestTypeSchema,
    },
    async (args) => {
      const requestId = generateRequestId();
      logger.info('test_type tool called', { requestId, selector: args.selector, textLength: args.text.length });

      try {
        const browserManager = getBrowserManager();
        const bridge = getExtensionBridge();

        // Get session
        let sessionId = args.sessionId;
        if (!sessionId) {
          const sessions = browserManager.getActiveSessions();
          if (sessions.length === 0) {
            return routerErrorResponse(new Error('No active browser session. Run test_launch_browser or test_open_dashboard first.'));
          }
          const firstSession = sessions[0];
          if (!firstSession) {
            return routerErrorResponse(new Error('No active browser session found.'));
          }
          sessionId = firstSession.sessionId;
        }

        const session = browserManager.getSession(sessionId);
        if (!session || !session.isActive) {
          return routerErrorResponse(new Error(`Session '${sessionId}' not found or inactive.`));
        }

        if (!session.extensionId) {
          return routerErrorResponse(new Error('No extension connected to this session.'));
        }

        const result = await bridge.sendCommand(session.extensionId, 'typeText', {
          selector: args.selector,
          text: args.text,
          clearFirst: args.clearFirst,
          pressEnter: args.pressEnter,
        }) as Record<string, unknown>;

        logger.info('test_type tool completed', { requestId, selector: args.selector });

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ requestId, result }, null, 2),
            },
          ],
        };
      } catch (error) {
        logger.error('test_type tool failed', error instanceof Error ? error : new Error(String(error)), { requestId });
        return routerErrorResponse(error);
      }
    }
  );

  logger.info('test_type tool registered');
}

/**
 * Register test_fill_form tool
 */
export function registerTestFillFormTool(server: McpServer): void {
  server.registerTool(
    'test_fill_form',
    {
      title: 'Testing: Fill Form',
      description: 'Fill an entire form with multiple fields. Supports text inputs, selects, checkboxes, radio buttons, and click actions.',
      inputSchema: TestFillFormSchema,
    },
    async (args) => {
      const requestId = generateRequestId();
      logger.info('test_fill_form tool called', { requestId, fieldCount: args.fields.length });

      try {
        const browserManager = getBrowserManager();
        const bridge = getExtensionBridge();

        // Get session
        let sessionId = args.sessionId;
        if (!sessionId) {
          const sessions = browserManager.getActiveSessions();
          if (sessions.length === 0) {
            return routerErrorResponse(new Error('No active browser session. Run test_launch_browser or test_open_dashboard first.'));
          }
          const firstSession = sessions[0];
          if (!firstSession) {
            return routerErrorResponse(new Error('No active browser session found.'));
          }
          sessionId = firstSession.sessionId;
        }

        const session = browserManager.getSession(sessionId);
        if (!session || !session.isActive) {
          return routerErrorResponse(new Error(`Session '${sessionId}' not found or inactive.`));
        }

        if (!session.extensionId) {
          return routerErrorResponse(new Error('No extension connected to this session.'));
        }

        const result = await bridge.sendCommand(session.extensionId, 'fillForm', {
          fields: args.fields,
        }) as Record<string, unknown>;

        logger.info('test_fill_form tool completed', { requestId, fieldsCompleted: result['fieldsCompleted'] });

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ requestId, result }, null, 2),
            },
          ],
        };
      } catch (error) {
        logger.error('test_fill_form tool failed', error instanceof Error ? error : new Error(String(error)), { requestId });
        return routerErrorResponse(error);
      }
    }
  );

  logger.info('test_fill_form tool registered');
}

/**
 * Register test_hover tool
 */
export function registerTestHoverTool(server: McpServer): void {
  server.registerTool(
    'test_hover',
    {
      title: 'Testing: Hover Element',
      description: 'Hover over an element with visual feedback. Useful for testing hover states, tooltips, and dropdown menus.',
      inputSchema: TestHoverSchema,
    },
    async (args) => {
      const requestId = generateRequestId();
      logger.info('test_hover tool called', { requestId, selector: args.selector });

      try {
        const browserManager = getBrowserManager();
        const bridge = getExtensionBridge();

        // Get session
        let sessionId = args.sessionId;
        if (!sessionId) {
          const sessions = browserManager.getActiveSessions();
          if (sessions.length === 0) {
            return routerErrorResponse(new Error('No active browser session. Run test_launch_browser or test_open_dashboard first.'));
          }
          const firstSession = sessions[0];
          if (!firstSession) {
            return routerErrorResponse(new Error('No active browser session found.'));
          }
          sessionId = firstSession.sessionId;
        }

        const session = browserManager.getSession(sessionId);
        if (!session || !session.isActive) {
          return routerErrorResponse(new Error(`Session '${sessionId}' not found or inactive.`));
        }

        if (!session.extensionId) {
          return routerErrorResponse(new Error('No extension connected to this session.'));
        }

        const result = await bridge.sendCommand(session.extensionId, 'hoverElement', {
          selector: args.selector,
        }) as Record<string, unknown>;

        logger.info('test_hover tool completed', { requestId, selector: args.selector });

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ requestId, result }, null, 2),
            },
          ],
        };
      } catch (error) {
        logger.error('test_hover tool failed', error instanceof Error ? error : new Error(String(error)), { requestId });
        return routerErrorResponse(error);
      }
    }
  );

  logger.info('test_hover tool registered');
}

/**
 * Register test_wait_for tool
 */
export function registerTestWaitForTool(server: McpServer): void {
  server.registerTool(
    'test_wait_for',
    {
      title: 'Testing: Wait for Element',
      description: 'Wait for an element to appear in the DOM. Useful after navigation or when elements load asynchronously.',
      inputSchema: TestWaitForSchema,
    },
    async (args) => {
      const requestId = generateRequestId();
      logger.info('test_wait_for tool called', { requestId, selector: args.selector, timeout: args.timeout });

      try {
        const browserManager = getBrowserManager();
        const bridge = getExtensionBridge();

        // Get session
        let sessionId = args.sessionId;
        if (!sessionId) {
          const sessions = browserManager.getActiveSessions();
          if (sessions.length === 0) {
            return routerErrorResponse(new Error('No active browser session. Run test_launch_browser or test_open_dashboard first.'));
          }
          const firstSession = sessions[0];
          if (!firstSession) {
            return routerErrorResponse(new Error('No active browser session found.'));
          }
          sessionId = firstSession.sessionId;
        }

        const session = browserManager.getSession(sessionId);
        if (!session || !session.isActive) {
          return routerErrorResponse(new Error(`Session '${sessionId}' not found or inactive.`));
        }

        if (!session.extensionId) {
          return routerErrorResponse(new Error('No extension connected to this session.'));
        }

        const result = await bridge.sendCommand(session.extensionId, 'waitForElement', {
          selector: args.selector,
          timeout: args.timeout,
        }) as Record<string, unknown>;

        logger.info('test_wait_for tool completed', { requestId, found: result['found'] });

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ requestId, result }, null, 2),
            },
          ],
        };
      } catch (error) {
        logger.error('test_wait_for tool failed', error instanceof Error ? error : new Error(String(error)), { requestId });
        return routerErrorResponse(error);
      }
    }
  );

  logger.info('test_wait_for tool registered');
}
