/**
 * MCP Tool Handlers for Assignment Modes
 * Provides tools for creating and managing structured assignments
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  assignmentManager,
  AssignmentMode,
  AssignmentPriority,
  CreateAssignmentConfig,
  ASSIGNMENT_TEMPLATES,
  AssignmentStatus
} from '../core/assignmentModes.js';

// ============================================================================
// Zod Input Schemas
// ============================================================================

const CreateAssignmentInputSchema = z.object({
  mode: z.enum(Object.values(AssignmentMode) as [string, ...string[]]).describe('Assignment mode (explorer, tester, auditor, benchmarker, migrator, optimizer, documenter, custom)'),
  title: z.string().describe('Assignment title'),
  description: z.string().describe('Detailed description of the assignment'),
  priority: z.enum(Object.values(AssignmentPriority) as [string, ...string[]]).optional().describe('Assignment priority (critical, high, medium, low)'),
  estimatedDuration: z.number().optional().describe('Estimated duration in minutes'),
  objectives: z.array(z.object({
    title: z.string().optional(),
    description: z.string().optional(),
    priority: z.enum(Object.values(AssignmentPriority) as [string, ...string[]]).optional(),
    estimatedDuration: z.number().optional(),
    dependencies: z.array(z.string()).optional()
  })).optional().describe('Array of objective objects (optional - uses mode defaults if not provided)')
});

const StartAssignmentInputSchema = z.object({
  assignmentId: z.string().describe('ID of the assignment to start')
});

const ResumeAssignmentInputSchema = z.object({
  assignmentId: z.string().describe('ID of the assignment to resume')
});

const PauseAssignmentInputSchema = z.object({});

const CompleteObjectiveInputSchema = z.object({
  objectiveId: z.string().describe('ID of the objective to complete'),
  evidence: z.string().optional().describe('Evidence of completion (screenshot URL, log excerpt, etc.)'),
  notes: z.string().optional().describe('Additional notes about completion')
});

const AddCheckpointInputSchema = z.object({
  objectiveId: z.string().describe('ID of the objective to add checkpoint to'),
  description: z.string().describe('Description of the checkpoint'),
  evidence: z.string().optional().describe('Evidence for this checkpoint (screenshot, log, etc.)')
});

const CompleteCheckpointInputSchema = z.object({
  checkpointId: z.string().describe('ID of the checkpoint to complete'),
  evidence: z.string().optional().describe('Evidence of completion')
});

const FailObjectiveInputSchema = z.object({
  objectiveId: z.string().describe('ID of the objective that failed'),
  error: z.string().describe('Error message describing the failure')
});

const GetAssignmentStatusInputSchema = z.object({
  assignmentId: z.string().optional().describe('ID of the assignment (empty for current assignment)')
});

const GetCurrentObjectiveInputSchema = z.object({});

const GetAssignmentTemplatesInputSchema = z.object({});

const CompleteAssignmentInputSchema = z.object({
  assignmentId: z.string().describe('ID of the assignment to complete')
});

const CancelAssignmentInputSchema = z.object({
  assignmentId: z.string().describe('ID of the assignment to cancel')
});

const CreateExplorerAssignmentInputSchema = z.object({
  title: z.string().optional().describe('Assignment title'),
  description: z.string().optional().describe('Assignment description'),
  priority: z.enum(Object.values(AssignmentPriority) as [string, ...string[]]).optional().describe('Assignment priority')
});

const CreateTesterAssignmentInputSchema = z.object({
  title: z.string().optional().describe('Assignment title'),
  description: z.string().optional().describe('Assignment description'),
  urls: z.array(z.string()).optional().describe('List of URLs to test (optional - will discover if not provided)'),
  priority: z.enum(Object.values(AssignmentPriority) as [string, ...string[]]).optional().describe('Assignment priority')
});

const GetAssignmentReportInputSchema = z.object({
  assignmentId: z.string().optional().describe('ID of the assignment to report on (empty for current)')
});



// ============================================================================
// Helper Functions for Runtime Validation
// ============================================================================

function isValidAssignmentMode(value: string): value is AssignmentMode {
  return Object.values(AssignmentMode).includes(value as AssignmentMode);
}

function isValidAssignmentPriority(value: string | undefined): value is AssignmentPriority {
  if (value === undefined) return false;
  return Object.values(AssignmentPriority).includes(value as AssignmentPriority);
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Helper to format response as MCP tool result
 */
function formatResponse(data: unknown): { content: Array<{ type: 'text'; text: string }> } {
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(data, null, 2)
      }
    ]
  };
}

/**
 * Register all assignment mode tools with MCP server
 */
export function registerAssignmentTools(server: McpServer): void {

  // ============================================================================
  // Assignment Management Tools
  // ============================================================================

  server.registerTool(
    'create_assignment',
    {
      title: 'Assignment: Create Assignment',
      description: 'Create a new structured assignment with objectives and checkpoints',
      inputSchema: CreateAssignmentInputSchema
    },
    async (args) => {
      try {
        // Validate title
        if (!args.title || typeof args.title !== 'string' || args.title.trim() === '') {
          return formatResponse({ success: false, error: 'title is required and cannot be empty' });
        }
        // Validate description
        if (!args.description || typeof args.description !== 'string' || args.description.trim() === '') {
          return formatResponse({ success: false, error: 'description is required and cannot be empty' });
        }
        if (!isValidAssignmentMode(args.mode)) {
          return formatResponse({
            success: false,
            error: `Invalid mode: ${args.mode}. Valid modes are: ${Object.values(AssignmentMode).join(', ')}`
          });
        }

        const priority = args.priority !== undefined && isValidAssignmentPriority(args.priority)
          ? args.priority
          : AssignmentPriority.MEDIUM;

        const config: CreateAssignmentConfig = {
          mode: args.mode,
          title: args.title,
          description: args.description,
          priority,
          createdBy: 'mcp-user'
        };
        if (args.estimatedDuration !== undefined) {
          config.estimatedDuration = args.estimatedDuration;
        }
        if (args.objectives !== undefined) {
          config.objectives = args.objectives as Partial<import('../core/assignmentModes.js').AssignmentObjective>[];
        }

        const assignment = await assignmentManager.createAssignment(config);

        return formatResponse({
          success: true,
          assignmentId: assignment.id,
          mode: assignment.mode,
          title: assignment.title,
          objectivesCount: assignment.objectives.length,
          estimatedDuration: config.estimatedDuration,
          message: `Assignment "${assignment.title}" created with ${assignment.objectives.length} objectives`
        });
      } catch (error: unknown) {
        return formatResponse({
          success: false,
          error: getErrorMessage(error)
        });
      }
    }
  );

  server.registerTool(
    'start_assignment',
    {
      title: 'Assignment: Start Assignment',
      description: 'Start a previously created assignment and begin execution',
      inputSchema: StartAssignmentInputSchema
    },
    async (args) => {
      try {
        if (!args.assignmentId || typeof args.assignmentId !== 'string') {
          return formatResponse({ success: false, error: 'assignmentId is required' });
        }
        const assignment = await assignmentManager.startAssignment(args.assignmentId);

        return formatResponse({
          success: true,
          assignmentId: assignment.id,
          title: assignment.title,
          status: assignment.status,
          currentObjective: assignment.objectives[assignment.state.currentObjectiveIndex]?.title,
          objectivesCount: assignment.objectives.length,
          message: `Started assignment "${assignment.title}"`
        });
      } catch (error: unknown) {
        return formatResponse({
          success: false,
          error: getErrorMessage(error)
        });
      }
    }
  );

  server.registerTool(
    'resume_assignment',
    {
      title: 'Assignment: Resume Assignment',
      description: 'Resume a paused assignment from where it left off',
      inputSchema: ResumeAssignmentInputSchema
    },
    async (args) => {
      try {
        if (!args.assignmentId || typeof args.assignmentId !== 'string') {
          return formatResponse({ success: false, error: 'assignmentId is required' });
        }
        const assignment = await assignmentManager.resumeAssignment(args.assignmentId);

        return formatResponse({
          success: true,
          assignmentId: assignment.id,
          title: assignment.title,
          status: assignment.status,
          progress: assignment.state.progress,
          message: `Resumed assignment "${assignment.title}" at ${assignment.state.progress}%`
        });
      } catch (error: unknown) {
        return formatResponse({
          success: false,
          error: getErrorMessage(error)
        });
      }
    }
  );

  server.registerTool(
    'pause_assignment',
    {
      title: 'Assignment: Pause Assignment',
      description: 'Pause the currently running assignment',
      inputSchema: PauseAssignmentInputSchema
    },
    async () => {
      try {
        const assignment = await assignmentManager.pauseAssignment();

        if (!assignment) {
          return formatResponse({
            success: false,
            error: 'No assignment is currently running'
          });
        }

        return formatResponse({
          success: true,
          assignmentId: assignment.id,
          title: assignment.title,
          status: assignment.status,
          progress: assignment.state.progress,
          message: `Paused assignment "${assignment.title}" at ${assignment.state.progress}%`
        });
      } catch (error: unknown) {
        return formatResponse({
          success: false,
          error: getErrorMessage(error)
        });
      }
    }
  );

  // ============================================================================
  // Objective Management Tools
  // ============================================================================

  server.registerTool(
    'complete_objective',
    {
      title: 'Assignment: Complete Objective',
      description: 'Mark the current objective as completed and move to next',
      inputSchema: CompleteObjectiveInputSchema
    },
    async (args) => {
      try {
        if (!args.objectiveId || typeof args.objectiveId !== 'string') {
          return formatResponse({ success: false, error: 'objectiveId is required' });
        }
        const assignment = await assignmentManager.completeObjective(
          args.objectiveId,
          args.evidence,
          args.notes
        );

        return formatResponse({
          success: true,
          assignmentId: assignment.id,
          objectiveId: args.objectiveId,
          progress: assignment.state.progress,
          nextObjective: assignment.objectives[assignment.state.currentObjectiveIndex]?.title,
          message: `Completed objective and progressed to ${assignment.state.progress}%`
        });
      } catch (error: unknown) {
        return formatResponse({
          success: false,
          error: getErrorMessage(error)
        });
      }
    }
  );

  server.registerTool(
    'add_checkpoint',
    {
      title: 'Assignment: Add Checkpoint',
      description: 'Add a progress checkpoint to current objective',
      inputSchema: AddCheckpointInputSchema
    },
    async (args) => {
      try {
        if (!args.objectiveId || typeof args.objectiveId !== 'string') {
          return formatResponse({ success: false, error: 'objectiveId is required' });
        }
        if (!args.description || typeof args.description !== 'string' || args.description.trim() === '') {
          return formatResponse({ success: false, error: 'description is required and cannot be empty' });
        }
        const assignment = await assignmentManager.addCheckpoint(
          args.objectiveId,
          args.description,
          args.evidence
        );

        return formatResponse({
          success: true,
          assignmentId: assignment.id,
          objectiveId: args.objectiveId,
          message: `Added checkpoint: ${args.description}`
        });
      } catch (error: unknown) {
        return formatResponse({
          success: false,
          error: getErrorMessage(error)
        });
      }
    }
  );

  server.registerTool(
    'complete_checkpoint',
    {
      title: 'Assignment: Complete Checkpoint',
      description: 'Mark a checkpoint as completed',
      inputSchema: CompleteCheckpointInputSchema
    },
    async (args) => {
      try {
        if (!args.checkpointId || typeof args.checkpointId !== 'string') {
          return formatResponse({ success: false, error: 'checkpointId is required' });
        }
        const assignment = await assignmentManager.completeCheckpoint(
          args.checkpointId,
          args.evidence
        );

        return formatResponse({
          success: true,
          assignmentId: assignment.id,
          checkpointId: args.checkpointId,
          message: `Completed checkpoint ${args.checkpointId}`
        });
      } catch (error: unknown) {
        return formatResponse({
          success: false,
          error: getErrorMessage(error)
        });
      }
    }
  );

  server.registerTool(
    'fail_objective',
    {
      title: 'Assignment: Fail Objective',
      description: 'Mark current objective as failed (will retry if under max retries)',
      inputSchema: FailObjectiveInputSchema
    },
    async (args) => {
      try {
        if (!args.objectiveId || typeof args.objectiveId !== 'string') {
          return formatResponse({ success: false, error: 'objectiveId is required' });
        }
        if (!args.error || typeof args.error !== 'string' || args.error.trim() === '') {
          return formatResponse({ success: false, error: 'error is required and cannot be empty' });
        }
        const assignment = await assignmentManager.failObjective(
          args.objectiveId,
          args.error
        );

        return formatResponse({
          success: true,
          assignmentId: assignment.id,
          objectiveId: args.objectiveId,
          retryCount: assignment.metadata.retries,
          status: assignment.status,
          message: `Objective failed. Retry ${assignment.metadata.retries}/${assignment.settings.maxRetries}`
        });
      } catch (error: unknown) {
        return formatResponse({
          success: false,
          error: getErrorMessage(error)
        });
      }
    }
  );

  // ============================================================================
  // Query & Status Tools
  // ============================================================================

  server.registerTool(
    'get_assignment_status',
    {
      title: 'Assignment: Get Status',
      description: 'Get current status and progress of an assignment',
      inputSchema: GetAssignmentStatusInputSchema
    },
    async (args) => {
      try {
        let assignmentId = args.assignmentId;
        if (!assignmentId) {
          const current = assignmentManager.getCurrentAssignment();
          assignmentId = current?.id;
        }

        if (!assignmentId) {
          return formatResponse({
            success: false,
            error: 'No assignment specified and no current assignment'
          });
        }

        const report = assignmentManager.getAssignmentReport(assignmentId);

        return formatResponse({
          success: true,
          ...report
        });
      } catch (error: unknown) {
        return formatResponse({
          success: false,
          error: getErrorMessage(error)
        });
      }
    }
  );

  server.registerTool(
    'get_current_objective',
    {
      title: 'Assignment: Get Current Objective',
      description: 'Get the next objective to work on',
      inputSchema: GetCurrentObjectiveInputSchema
    },
    async () => {
      try {
        const objective = assignmentManager.getNextObjective();
        const assignment = assignmentManager.getCurrentAssignment();

        if (!objective || !assignment) {
          return formatResponse({
            success: false,
            error: 'No current assignment or all objectives completed'
          });
        }

        return formatResponse({
          success: true,
          assignmentId: assignment.id,
          objective: {
            id: objective.id,
            title: objective.title,
            description: objective.description,
            priority: objective.priority,
            dependencies: objective.dependencies,
            checkpoints: objective.checkpoints,
            estimatedDuration: objective.estimatedDuration
          },
          assignmentProgress: assignment.state.progress,
          totalObjectives: assignment.objectives.length,
          completedObjectives: assignment.state.completedObjectives.length
        });
      } catch (error: unknown) {
        return formatResponse({
          success: false,
          error: getErrorMessage(error)
        });
      }
    }
  );

  server.registerTool(
    'get_assignment_templates',
    {
      title: 'Assignment: Get Templates',
      description: 'Get available assignment mode templates and their configurations',
      inputSchema: GetAssignmentTemplatesInputSchema
    },
    async () => {
      try {
        const templates = Object.values(AssignmentMode).map(mode => {
          const template = ASSIGNMENT_TEMPLATES[mode];
          return {
            mode,
            name: template.name,
            description: template.description,
            defaultObjectives: template.defaultObjectives.map(obj => ({
              title: obj.title,
              description: obj.description,
              priority: obj.priority
            })),
            toolsRequired: template.toolsRequired,
            prerequisites: template.prerequisites,
            settings: template.defaultSettings
          };
        });

        return formatResponse({
          success: true,
          templates
        });
      } catch (error: unknown) {
        return formatResponse({
          success: false,
          error: getErrorMessage(error)
        });
      }
    }
  );

  server.registerTool(
    'complete_assignment',
    {
      title: 'Assignment: Complete Assignment',
      description: 'Manually complete an assignment (use when all objectives are done)',
      inputSchema: CompleteAssignmentInputSchema
    },
    async (args) => {
      try {
        if (!args.assignmentId || typeof args.assignmentId !== 'string') {
          return formatResponse({ success: false, error: 'assignmentId is required' });
        }
        const assignment = await assignmentManager.completeAssignment(args.assignmentId);

        return formatResponse({
          success: true,
          assignmentId: assignment.id,
          title: assignment.title,
          duration: assignment.metadata.actualDuration,
          objectivesCompleted: assignment.state.completedObjectives.length,
          totalObjectives: assignment.objectives.length,
          message: `Assignment "${assignment.title}" completed successfully`
        });
      } catch (error: unknown) {
        return formatResponse({
          success: false,
          error: getErrorMessage(error)
        });
      }
    }
  );

  server.registerTool(
    'cancel_assignment',
    {
      title: 'Assignment: Cancel Assignment',
      description: 'Cancel an assignment (can be resumed later)',
      inputSchema: CancelAssignmentInputSchema
    },
    async (args) => {
      try {
        if (!args.assignmentId || typeof args.assignmentId !== 'string') {
          return formatResponse({ success: false, error: 'assignmentId is required' });
        }
        const assignment = await assignmentManager.cancelAssignment(args.assignmentId);

        return formatResponse({
          success: true,
          assignmentId: assignment.id,
          title: assignment.title,
          progress: assignment.state.progress,
          message: `Assignment "${assignment.title}" cancelled at ${assignment.state.progress}%`
        });
      } catch (error: unknown) {
        return formatResponse({
          success: false,
          error: getErrorMessage(error)
        });
      }
    }
  );

  // ============================================================================
  // Advanced Assignment Tools
  // ============================================================================

  server.registerTool(
    'create_explorer_assignment',
    {
      title: 'Assignment: Create Explorer',
      description: 'Create a codebase explorer assignment to discover URLs and structure',
      inputSchema: CreateExplorerAssignmentInputSchema
    },
    async (args) => {
      try {
        const priority = args.priority !== undefined && isValidAssignmentPriority(args.priority)
          ? args.priority
          : AssignmentPriority.HIGH;

        const config: CreateAssignmentConfig = {
          mode: AssignmentMode.EXPLORER,
          title: args.title ?? 'Codebase Explorer Assignment',
          description: args.description ?? 'Explore the entire codebase and discover all URLs and endpoints',
          priority,
          createdBy: 'mcp-user'
        };

        const assignment = await assignmentManager.createAssignment(config);

        return formatResponse({
          success: true,
          assignmentId: assignment.id,
          title: assignment.title,
          objectives: assignment.objectives.map(obj => ({
            id: obj.id,
            title: obj.title,
            description: obj.description
          })),
          message: `Created explorer assignment with ${assignment.objectives.length} objectives`
        });
      } catch (error: unknown) {
        return formatResponse({
          success: false,
          error: getErrorMessage(error)
        });
      }
    }
  );

  server.registerTool(
    'create_tester_assignment',
    {
      title: 'Assignment: Create Tester',
      description: 'Create a comprehensive testing assignment for discovered URLs',
      inputSchema: CreateTesterAssignmentInputSchema
    },
    async (args) => {
      try {
        const priority = args.priority !== undefined && isValidAssignmentPriority(args.priority)
          ? args.priority
          : AssignmentPriority.CRITICAL;

        const config: CreateAssignmentConfig = {
          mode: AssignmentMode.TESTER,
          title: args.title ?? 'Comprehensive Testing Assignment',
          description: args.description ?? 'Test all discovered URLs with comprehensive test plan',
          priority,
          createdBy: 'mcp-user'
        };

        // If URLs provided, create custom objectives
        if (args.urls !== undefined && args.urls.length > 0) {
          const urls = args.urls;
          const customObjectives = urls.map((url: string, index: number) => ({
            title: `Test URL: ${url}`,
            description: `Comprehensive testing of ${url} including functionality, performance, and security`,
            priority: AssignmentPriority.HIGH,
            // Dependencies will be resolved by createAssignment() based on index order
            // Leave empty - sequential execution is handled by the assignment manager
            dependencies: [] as string[]
          }));

          config.objectives = customObjectives;
        }

        const assignment = await assignmentManager.createAssignment(config);

        return formatResponse({
          success: true,
          assignmentId: assignment.id,
          title: assignment.title,
          objectives: assignment.objectives.map(obj => ({
            id: obj.id,
            title: obj.title,
            description: obj.description
          })),
          message: `Created testing assignment with ${assignment.objectives.length} objectives`
        });
      } catch (error: unknown) {
        return formatResponse({
          success: false,
          error: getErrorMessage(error)
        });
      }
    }
  );

  server.registerTool(
    'get_assignment_report',
    {
      title: 'Assignment: Get Report',
      description: 'Generate comprehensive report of assignment execution',
      inputSchema: GetAssignmentReportInputSchema
    },
    async (args) => {
      try {
        let assignmentId = args.assignmentId;
        if (!assignmentId) {
          const current = assignmentManager.getCurrentAssignment();
          assignmentId = current?.id;
        }

        if (!assignmentId) {
          return formatResponse({
            success: false,
            error: 'No assignment specified and no current assignment'
          });
        }

        const report = assignmentManager.getAssignmentReport(assignmentId);

        // Format report for display
        const formattedReport = `
# Assignment Report: ${report.title}

## Overview
- **Assignment ID**: ${report.assignmentId}
- **Mode**: ${report.mode}
- **Status**: ${report.status}
- **Priority**: ${report.priority}
- **Progress**: ${report.progress}%
- **Created**: ${report.createdAt.toISOString()}
- **Last Updated**: ${report.updatedAt.toISOString()}

## Objectives (${report.objectives.length} total)

${report.objectives.map((obj, i) => `
### ${i + 1}. ${obj.title}
- **Status**: ${obj.completed ? '✅ Completed' : '❌ Not Started'}
- **Priority**: ${obj.priority}
- **Checkpoints**: ${obj.checkpointsCompleted}/${obj.totalCheckpoints}
- **Estimated Duration**: ${obj.estimatedDuration || 'N/A'} minutes
- **Actual Duration**: ${obj.actualDuration || 'N/A'} minutes
${obj.artifacts.length > 0 ? `- **Artifacts**: ${obj.artifacts.join(', ')}` : ''}
`).join('')}

## Sessions (${report.sessions.length})

${report.sessions.map((session, i) => `
### Session ${i + 1}
- **Started**: ${session.startedAt.toISOString()}
- **Duration**: ${Math.round(session.duration / 1000 / 60)} minutes
- **Objectives Attempted**: ${session.objectivesAttempted.length}
- **Objectives Completed**: ${session.objectivesCompleted.length}
${session.errors.length > 0 ? `- **Errors**: ${session.errors.length}` : ''}
`).join('')}

${report.errors.length > 0 ? `## Errors (${report.errors.length})

${report.errors.map(err => `
- **${err.timestamp.toISOString()}**: ${err.error}
  - Context: ${err.context}
`).join('')}

` : ''}
## Artifacts

${report.artifacts.length > 0 ? report.artifacts.map(art => `- ${art}`).join('\n') : 'No artifacts generated'}

---
*Generated by MCP Router Assignment Manager*
        `.trim();

        return formatResponse({
          success: true,
          assignmentId: report.assignmentId,
          formattedReport,
          report: report,
          message: 'Assignment report generated successfully'
        });
      } catch (error: unknown) {
        return formatResponse({
          success: false,
          error: getErrorMessage(error)
        });
      }
    }
  );
}