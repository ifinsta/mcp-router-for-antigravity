/**
 * Workflow Recorder
 *
 * Captures browser actions and generates test code from recorded workflows.
 * Provides LRU-based storage for up to 50 workflows.
 */

import type { RecordedAction, RecordedWorkflow } from './types.js';
import { getLogger } from '../infra/logger.js';

const logger = getLogger('workflow-recorder');

/** Maximum number of stored workflows (LRU eviction) */
const MAX_WORKFLOWS = 50;

/**
 * Internal workflow state during recording
 */
interface RecordingWorkflow {
  id: string;
  name: string;
  startedAt: string;
  endedAt?: string;
  actions: RecordedAction[];
  lastAccessedAt: number;
}

/**
 * WorkflowRecorder captures browser actions and generates test code.
 *
 * Features:
 * - Start/stop recording sessions
 * - Record individual actions
 * - Generate browser.* MCP tool calls from recorded actions
 * - Generate basic assertions from actions
 * - LRU-based storage with max 50 workflows
 */
export class WorkflowRecorder {
  private readonly workflows: Map<string, RecordingWorkflow> = new Map();
  private readonly accessOrder: string[] = [];
  private activeRecordingId: string | null = null;

  /**
   * Start a new recording session.
   * @param name - Human-readable name for the workflow
   * @returns The workflow ID
   */
  startRecording(name: string): string {
    // If there's an active recording, stop it first
    if (this.activeRecordingId !== null) {
      this.stopRecording(this.activeRecordingId);
    }

    const id = this.generateId();
    const workflow: RecordingWorkflow = {
      id,
      name,
      startedAt: new Date().toISOString(),
      actions: [],
      lastAccessedAt: Date.now(),
    };

    this.workflows.set(id, workflow);
    this.accessOrder.push(id);
    this.activeRecordingId = id;

    // Enforce LRU eviction
    this.enforceMaxWorkflows();

    logger.info('Started recording workflow', { id, name });
    return id;
  }

  /**
   * Stop an active recording session.
   * @param workflowId - The workflow ID to stop
   * @returns The completed RecordedWorkflow
   * @throws Error if workflow not found
   */
  stopRecording(workflowId: string): RecordedWorkflow {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) {
      throw new Error(`Workflow not found: ${workflowId}`);
    }

    workflow.endedAt = new Date().toISOString();
    workflow.lastAccessedAt = Date.now();
    this.updateAccessOrder(workflowId);

    // Clear active recording if this was it
    if (this.activeRecordingId === workflowId) {
      this.activeRecordingId = null;
    }

    const result = this.toRecordedWorkflow(workflow);
    logger.info('Stopped recording workflow', {
      id: workflowId,
      actionCount: workflow.actions.length,
    });

    return result;
  }

  /**
   * Record an action in an active workflow.
   * @param workflowId - The workflow ID
   * @param action - The action to record
   * @throws Error if workflow not found or recording is stopped
   */
  recordAction(workflowId: string, action: RecordedAction): void {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) {
      throw new Error(`Workflow not found: ${workflowId}`);
    }

    if (workflow.endedAt !== undefined) {
      throw new Error(`Workflow ${workflowId} has already been stopped`);
    }

    workflow.actions.push(action);
    workflow.lastAccessedAt = Date.now();
    this.updateAccessOrder(workflowId);

    logger.debug('Recorded action', {
      workflowId,
      actionType: action.type,
      selector: action.selector,
    });
  }

  /**
   * Get a workflow by ID.
   * @param workflowId - The workflow ID
   * @returns The workflow or undefined if not found
   */
  getWorkflow(workflowId: string): RecordedWorkflow | undefined {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) {
      return undefined;
    }

    workflow.lastAccessedAt = Date.now();
    this.updateAccessOrder(workflowId);
    return this.toRecordedWorkflow(workflow);
  }

  /**
   * List all stored workflows.
   * @returns Array of all workflows
   */
  listWorkflows(): RecordedWorkflow[] {
    const workflows: RecordedWorkflow[] = [];
    for (const workflow of this.workflows.values()) {
      workflows.push(this.toRecordedWorkflow(workflow));
    }
    // Sort by last accessed (most recent first)
    workflows.sort((a, b) => {
      const aTime = this.workflows.get(a.id)?.lastAccessedAt ?? 0;
      const bTime = this.workflows.get(b.id)?.lastAccessedAt ?? 0;
      return bTime - aTime;
    });
    return workflows;
  }

  /**
   * Generate browser.* MCP tool calls from recorded actions.
   * @param workflowId - The workflow ID
   * @returns Generated code as a string
   */
  generateCode(workflowId: string): string {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) {
      throw new Error(`Workflow not found: ${workflowId}`);
    }

    const lines: string[] = [];
    lines.push(`// Workflow: ${workflow.name}`);
    lines.push(`// Generated: ${new Date().toISOString()}`);
    lines.push('');

    for (const action of workflow.actions) {
      const code = this.actionToCode(action);
      lines.push(code);
    }

    return lines.join('\n');
  }

  /**
   * Generate assertion statements from recorded actions.
   * @param workflowId - The workflow ID
   * @returns Array of assertion statements
   */
  generateAssertions(workflowId: string): string[] {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) {
      throw new Error(`Workflow not found: ${workflowId}`);
    }

    const assertions: string[] = [];
    let previousUrl: string | null = null;

    for (const action of workflow.actions) {
      const actionAssertions = this.actionToAssertions(action, previousUrl);
      assertions.push(...actionAssertions);

      if (action.type === 'navigate' && action.url !== undefined) {
        previousUrl = action.url;
      }
    }

    return assertions;
  }

  // ---------------------------------------------------------------------------
  // Private Methods
  // ---------------------------------------------------------------------------

  private generateId(): string {
    return `wf_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  private enforceMaxWorkflows(): void {
    while (this.workflows.size > MAX_WORKFLOWS && this.accessOrder.length > 0) {
      const oldestId = this.accessOrder.shift();
      if (oldestId !== undefined && this.workflows.has(oldestId)) {
        this.workflows.delete(oldestId);
        logger.debug('Evicted workflow (LRU)', { id: oldestId });
      }
    }
  }

  private updateAccessOrder(workflowId: string): void {
    const index = this.accessOrder.indexOf(workflowId);
    if (index !== -1) {
      this.accessOrder.splice(index, 1);
    }
    this.accessOrder.push(workflowId);
  }

  private toRecordedWorkflow(workflow: RecordingWorkflow): RecordedWorkflow {
    return {
      id: workflow.id,
      name: workflow.name,
      startedAt: workflow.startedAt,
      ...(workflow.endedAt !== undefined ? { endedAt: workflow.endedAt } : {}),
      actions: workflow.actions,
      generatedCode: this.generateCode(workflow.id),
      generatedAssertions: this.generateAssertions(workflow.id),
    };
  }

  private actionToCode(action: RecordedAction): string {
    switch (action.type) {
      case 'click':
        return `browser.click({ selector: '${this.escapeString(action.selector ?? '')}' });`;

      case 'type':
        return `browser.type({ selector: '${this.escapeString(action.selector ?? '')}', text: '${this.escapeString(action.value ?? '')}' });`;

      case 'navigate':
        return `browser.navigate({ url: '${this.escapeString(action.url ?? '')}' });`;

      case 'select':
        return `browser.select({ selector: '${this.escapeString(action.selector ?? '')}', value: '${this.escapeString(action.value ?? '')}' });`;

      case 'scroll':
        return `browser.scroll({ selector: '${this.escapeString(action.selector ?? '')}' });`;

      case 'wait':
        return `browser.wait_for({ selector: '${this.escapeString(action.selector ?? '')}' });`;

      case 'screenshot':
        return `browser.screenshot({});`;

      case 'assert':
        return `// Assert: ${action.value ?? 'assertion'}`;

      default:
        return `// Unknown action type: ${(action as { type: string }).type}`;
    }
  }

  private actionToAssertions(action: RecordedAction, _previousUrl: string | null): string[] {
    const assertions: string[] = [];

    switch (action.type) {
      case 'navigate':
        if (action.url !== undefined) {
          assertions.push(`assert(page.url() === '${this.escapeString(action.url)}', 'URL should be ${this.escapeString(action.url)} after navigation');`);
        }
        break;

      case 'click':
        if (action.selector !== undefined) {
          assertions.push(`assert(document.querySelector('${this.escapeString(action.selector)}') !== null, 'Element ${this.escapeString(action.selector)} should exist after click');`);
        }
        break;

      case 'type':
        if (action.selector !== undefined && action.value !== undefined) {
          assertions.push(`assert(document.querySelector('${this.escapeString(action.selector)}')?.value === '${this.escapeString(action.value)}', 'Input ${this.escapeString(action.selector)} should have value ${this.escapeString(action.value)}');`);
        }
        break;

      case 'select':
        if (action.selector !== undefined && action.value !== undefined) {
          assertions.push(`assert(document.querySelector('${this.escapeString(action.selector)}')?.value === '${this.escapeString(action.value)}', 'Select ${this.escapeString(action.selector)} should have value ${this.escapeString(action.value)}');`);
        }
        break;

      default:
        // No assertions for other action types
        break;
    }

    return assertions;
  }

  private escapeString(str: string): string {
    return str.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n');
  }
}

// Singleton instance
let recorderInstance: WorkflowRecorder | null = null;

/**
 * Get the singleton WorkflowRecorder instance.
 * @returns The WorkflowRecorder instance
 */
export function getWorkflowRecorder(): WorkflowRecorder {
  if (!recorderInstance) {
    recorderInstance = new WorkflowRecorder();
    logger.info('WorkflowRecorder singleton initialized');
  }
  return recorderInstance;
}
