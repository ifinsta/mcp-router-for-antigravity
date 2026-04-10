/**
 * Assignment Modes System
 * Provides structured, persistent workflows for AI agents with objective tracking
 */

import { z } from 'zod';
import { getLogger } from '../infra/logger.js';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';

const logger = getLogger('assignment-modes');

// ============================================================================
// Memory Bounds Constants
// ============================================================================

const MAX_SESSION_HISTORY = 50;
const MAX_ERRORS_PER_SESSION = 200;
const MAX_COMPLETED_ASSIGNMENTS = 500;

// ============================================================================
// Async Mutex for Concurrency Protection
// ============================================================================

class AsyncMutex {
  private _lock: Promise<void> = Promise.resolve();

  async acquire(): Promise<() => void> {
    let release: () => void;
    const newLock = new Promise<void>(resolve => { release = resolve; });
    const previousLock = this._lock;
    this._lock = newLock;
    await previousLock;
    return release!;
  }
}

// ============================================================================
// Persistence Configuration
// ============================================================================

/**
 * Get the storage directory for assignments
 * Uses MCP_ROUTER_DATA_DIR env var, or OS-appropriate default
 */
function getStorageDirectory(): string {
  const envDir = process.env['MCP_ROUTER_DATA_DIR'];
  if (envDir) {
    return path.join(envDir, 'assignments');
  }

  const homeDir = os.homedir();
  const platform = os.platform();

  if (platform === 'win32') {
    const appData = process.env['APPDATA'] || homeDir;
    return path.join(appData, 'mcp-router', 'assignments');
  }

  // Linux/Mac
  const configDir = process.env['XDG_CONFIG_HOME'] || path.join(homeDir, '.config');
  return path.join(configDir, 'mcp-router', 'assignments');
}

/**
 * JSON replacer for Date serialization
 */
function dateReplacer(_key: string, value: unknown): unknown {
  if (value instanceof Date) {
    return { __type: 'Date', value: value.toISOString() };
  }
  return value;
}

/**
 * JSON reviver for Date deserialization
 */
function dateReviver(_key: string, value: unknown): unknown {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    if (obj['__type'] === 'Date' && typeof obj['value'] === 'string') {
      return new Date(obj['value']);
    }
  }
  return value;
}

/**
 * Recursively revive Date objects from ISO strings in all timestamp fields
 */
function reviveDates<T>(obj: T): T {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (obj instanceof Date) {
    return obj;
  }

  if (typeof obj === 'string') {
    // Check if it looks like an ISO date string
    const isoDateRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/;
    if (isoDateRegex.test(obj)) {
      const date = new Date(obj);
      if (!isNaN(date.getTime())) {
        return date as unknown as T;
      }
    }
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(reviveDates) as unknown as T;
  }

  if (typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      result[key] = reviveDates(value);
    }
    return result as T;
  }

  return obj;
}

// ============================================================================
// Assignment Mode Definitions
// ============================================================================

export enum AssignmentMode {
  EXPLORER = 'explorer',           // Discover and map codebase
  TESTER = 'tester',                 // Comprehensive testing
  AUDITOR = 'auditor',               // Security and compliance audit
  BENCHMARKER = 'benchmarker',       // Performance benchmarking
  MIGRATOR = 'migrator',           // Code migration tasks
  OPTIMIZER = 'optimizer',           // Performance optimization
  DOCUMENTER = 'documenter',         // Documentation generation
  CUSTOM = 'custom'                  // User-defined custom workflow
}

export enum AssignmentPriority {
  CRITICAL = 'critical',
  HIGH = 'high',
  MEDIUM = 'medium',
  LOW = 'low'
}

export enum AssignmentStatus {
  NOT_STARTED = 'not_started',
  IN_PROGRESS = 'in_progress',
  PAUSED = 'paused',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled'
}

// ============================================================================
// Assignment State Types
// ============================================================================

export interface AssignmentObjective {
  id: string;
  title: string;
  description: string;
  completed: boolean;
  priority: AssignmentPriority;
  estimatedDuration?: number; // in minutes
  actualDuration?: number;
  dependencies: string[]; // IDs of objectives that must complete first
  checkpoints: AssignmentCheckpoint[];
  artifacts?: string[]; // Generated artifacts (reports, screenshots, etc.)
  notes?: string;
  timestamp: {
    created: Date;
    started?: Date;
    completed?: Date;
    paused?: Date;
    resumed?: Date;
  };
}

export interface AssignmentCheckpoint {
  id: string;
  description: string;
  completed: boolean;
  evidence?: string; // Screenshot URL, log excerpt, etc.
  timestamp: Date;
  notes?: string;
}

export interface Assignment {
  id: string;
  mode: AssignmentMode;
  title: string;
  description: string;
  status: AssignmentStatus;
  priority: AssignmentPriority;
  objectives: AssignmentObjective[];
  settings: AssignmentSettings;
  metadata: AssignmentMetadata;
  state: AssignmentState;
}

export interface AssignmentSettings {
  focusMode: boolean; // Force agent to focus on assignment
  autoResume: boolean; // Automatically resume if interrupted
  maxRetries: number; // Number of retries before marking as failed
  timeoutMinutes?: number; // Overall timeout for assignment
  allowParallelObjectives: boolean; // Run multiple objectives simultaneously
  checkpointsRequired: boolean; // Require checkpoints for progress
  artifactRetention: 'none' | 'summary' | 'full'; // What to keep from artifacts
}

export interface AssignmentMetadata {
  createdAt: Date;
  updatedAt: Date;
  createdBy: string; // Agent ID or user ID
  assignedTo?: string; // Agent ID if different from creator
  estimatedDuration?: number; // Total estimated duration in minutes
  actualDuration?: number;
  retries: number;
  lastCheckpoint?: Date;
  resumeData?: any; // State for resuming interrupted assignments
}

export interface AssignmentState {
  currentObjectiveIndex: number;
  completedObjectives: string[];
  failedObjectives: string[];
  retryCount: Record<string, number>; // Per-objective retry count
  pausedAt?: Date;
  resumedAt?: Date;
  lastAction: string;
  progress: number; // 0-100 percentage
  sessionHistory: AssignmentSession[];
}

export interface AssignmentSession {
  id: string;
  startedAt: Date;
  endedAt?: Date;
  duration: number;
  objectivesAttempted: string[];
  objectivesCompleted: string[];
  errors: Array<{
    timestamp: Date;
    error: string;
    context: string;
  }>;
}

// ============================================================================
// Assignment Mode Templates
// ============================================================================

export interface AssignmentTemplate {
  mode: AssignmentMode;
  name: string;
  description: string;
  defaultSettings: AssignmentSettings;
  defaultObjectives: Partial<AssignmentObjective>[];
  toolsRequired: string[];
  prerequisites: string[];
}

export const ASSIGNMENT_TEMPLATES: Record<AssignmentMode, AssignmentTemplate> = {
  [AssignmentMode.EXPLORER]: {
    mode: AssignmentMode.EXPLORER,
    name: 'Codebase Explorer',
    description: 'Discover and map codebase structure, URLs, and relationships',
    defaultSettings: {
      focusMode: true,
      autoResume: true,
      maxRetries: 3,
      checkpointsRequired: true,
      allowParallelObjectives: false,
      artifactRetention: 'full'
    },
    defaultObjectives: [
      {
        title: 'Discover project structure',
        description: 'Analyze directory structure and identify main components',
        priority: AssignmentPriority.HIGH,
        dependencies: []
      },
      {
        title: 'Extract all URLs and endpoints',
        description: 'Find HTTP endpoints, API routes, and external URLs',
        priority: AssignmentPriority.CRITICAL,
        dependencies: ['discover-project-structure']
      },
      {
        title: 'Map code relationships',
        description: 'Identify dependencies and code relationships',
        priority: AssignmentPriority.MEDIUM,
        dependencies: ['extract-all-urls-and-endpoints']
      },
      {
        title: 'Generate documentation',
        description: 'Create comprehensive codebase documentation',
        priority: AssignmentPriority.HIGH,
        dependencies: ['map-code-relationships']
      }
    ],
    toolsRequired: ['file-read', 'grep', 'analyze-code'],
    prerequisites: ['codebase-access']
  },

  [AssignmentMode.TESTER]: {
    mode: AssignmentMode.TESTER,
    name: 'Comprehensive Tester',
    description: 'Systematic testing of discovered endpoints and functionality',
    defaultSettings: {
      focusMode: true,
      autoResume: true,
      maxRetries: 5,
      checkpointsRequired: true,
      allowParallelObjectives: true,
      artifactRetention: 'summary'
    },
    defaultObjectives: [
      {
        title: 'Create test plan',
        description: 'Design comprehensive test strategy based on discovered URLs',
        priority: AssignmentPriority.CRITICAL,
        dependencies: []
      },
      {
        title: 'Execute functional tests',
        description: 'Test each URL for basic functionality',
        priority: AssignmentPriority.CRITICAL,
        dependencies: ['create-test-plan']
      },
      {
        title: 'Run performance tests',
        description: 'Measure response times and identify bottlenecks',
        priority: AssignmentPriority.HIGH,
        dependencies: ['execute-functional-tests']
      },
      {
        title: 'Test edge cases',
        description: 'Test boundary conditions and error handling',
        priority: AssignmentPriority.MEDIUM,
        dependencies: ['execute-functional-tests']
      },
      {
        title: 'Generate test report',
        description: 'Compile comprehensive test results and recommendations',
        priority: AssignmentPriority.HIGH,
        dependencies: ['run-performance-tests', 'test-edge-cases']
      }
    ],
    toolsRequired: ['browser-launch', 'navigate', 'screenshot', 'click', 'type'],
    prerequisites: ['explorer-completed']
  },

  [AssignmentMode.AUDITOR]: {
    mode: AssignmentMode.AUDITOR,
    name: 'Security Auditor',
    description: 'Security and compliance audit of the codebase',
    defaultSettings: {
      focusMode: true,
      autoResume: false,
      maxRetries: 3,
      checkpointsRequired: true,
      allowParallelObjectives: false,
      artifactRetention: 'full'
    },
    defaultObjectives: [
      {
        title: 'Analyze security vulnerabilities',
        description: 'Identify OWASP Top 10 vulnerabilities',
        priority: AssignmentPriority.CRITICAL,
        dependencies: []
      },
      {
        title: 'Check authentication flows',
        description: 'Verify authentication and authorization mechanisms',
        priority: AssignmentPriority.CRITICAL,
        dependencies: ['analyze-security-vulnerabilities']
      },
      {
        title: 'Review API security',
        description: 'Audit API endpoints for security issues',
        priority: AssignmentPriority.HIGH,
        dependencies: ['analyze-security-vulnerabilities']
      },
      {
        title: 'Verify compliance requirements',
        description: 'Check against compliance standards (GDPR, PCI-DSS, etc.)',
        priority: AssignmentPriority.HIGH,
        dependencies: ['check-authentication-flows']
      },
      {
        title: 'Generate security report',
        description: 'Create detailed security audit report',
        priority: AssignmentPriority.CRITICAL,
        dependencies: ['verify-compliance-requirements', 'review-api-security']
      }
    ],
    toolsRequired: ['analyze-security', 'check-dependencies', 'scan-vulnerabilities'],
    prerequisites: ['codebase-access']
  },

  [AssignmentMode.BENCHMARKER]: {
    mode: AssignmentMode.BENCHMARKER,
    name: 'Performance Benchmarker',
    description: 'Comprehensive performance testing and benchmarking',
    defaultSettings: {
      focusMode: true,
      autoResume: true,
      maxRetries: 3,
      checkpointsRequired: true,
      allowParallelObjectives: true,
      artifactRetention: 'summary'
    },
    defaultObjectives: [
      {
        title: 'Establish baseline metrics',
        description: 'Measure initial performance of all endpoints',
        priority: AssignmentPriority.CRITICAL,
        dependencies: []
      },
      {
        title: 'Run load tests',
        description: 'Test performance under various load conditions',
        priority: AssignmentPriority.HIGH,
        dependencies: ['establish-baseline-metrics']
      },
      {
        title: 'Identify bottlenecks',
        description: 'Analyze performance bottlenecks and hotspots',
        priority: AssignmentPriority.HIGH,
        dependencies: ['run-load-tests']
      },
      {
        title: 'Compare with standards',
        description: 'Compare performance against industry standards',
        priority: AssignmentPriority.MEDIUM,
        dependencies: ['identify-bottlenecks']
      },
      {
        title: 'Generate benchmark report',
        description: 'Create comprehensive performance benchmark report',
        priority: AssignmentPriority.HIGH,
        dependencies: ['compare-with-standards']
      }
    ],
    toolsRequired: ['perf-measure', 'perf-profile', 'perf-analyze'],
    prerequisites: ['endpoints-discovered']
  },

  [AssignmentMode.MIGRATOR]: {
    mode: AssignmentMode.MIGRATOR,
    name: 'Code Migrator',
    description: 'Automated code migration and refactoring',
    defaultSettings: {
      focusMode: true,
      autoResume: true,
      maxRetries: 5,
      checkpointsRequired: true,
      allowParallelObjectives: false,
      artifactRetention: 'full'
    },
    defaultObjectives: [
      {
        title: 'Analyze current code',
        description: 'Understand code structure and dependencies',
        priority: AssignmentPriority.CRITICAL,
        dependencies: []
      },
      {
        title: 'Create migration plan',
        description: 'Design step-by-step migration strategy',
        priority: AssignmentPriority.CRITICAL,
        dependencies: ['analyze-current-code']
      },
      {
        title: 'Execute migration steps',
        description: 'Perform code changes according to plan',
        priority: AssignmentPriority.CRITICAL,
        dependencies: ['create-migration-plan']
      },
      {
        title: 'Verify functionality',
        description: 'Test that migrated code works correctly',
        priority: AssignmentPriority.CRITICAL,
        dependencies: ['execute-migration-steps']
      },
      {
        title: 'Update documentation',
        description: 'Update all relevant documentation',
        priority: AssignmentPriority.MEDIUM,
        dependencies: ['verify-functionality']
      }
    ],
    toolsRequired: ['analyze-code', 'edit-code', 'test-code', 'generate-docs'],
    prerequisites: ['codebase-access']
  },

  [AssignmentMode.OPTIMIZER]: {
    mode: AssignmentMode.OPTIMIZER,
    name: 'Performance Optimizer',
    description: 'Optimize code for better performance',
    defaultSettings: {
      focusMode: true,
      autoResume: true,
      maxRetries: 3,
      checkpointsRequired: true,
      allowParallelObjectives: true,
      artifactRetention: 'summary'
    },
    defaultObjectives: [
      {
        title: 'Profile performance',
        description: 'Identify performance bottlenecks and hotspots',
        priority: AssignmentPriority.CRITICAL,
        dependencies: []
      },
      {
        title: 'Optimize identified bottlenecks',
        description: 'Implement performance improvements',
        priority: AssignmentPriority.CRITICAL,
        dependencies: ['profile-performance']
      },
      {
        title: 'Test optimizations',
        description: 'Verify that optimizations improve performance',
        priority: AssignmentPriority.CRITICAL,
        dependencies: ['optimize-identified-bottlenecks']
      },
      {
        title: 'Document changes',
        description: 'Document all performance optimizations',
        priority: AssignmentPriority.MEDIUM,
        dependencies: ['test-optimizations']
      }
    ],
    toolsRequired: ['perf-profile', 'analyze-code', 'edit-code', 'test-code'],
    prerequisites: ['codebase-access']
  },

  [AssignmentMode.DOCUMENTER]: {
    mode: AssignmentMode.DOCUMENTER,
    name: 'Documentation Generator',
    description: 'Automated documentation generation',
    defaultSettings: {
      focusMode: true,
      autoResume: true,
      maxRetries: 3,
      checkpointsRequired: false,
      allowParallelObjectives: true,
      artifactRetention: 'full'
    },
    defaultObjectives: [
      {
        title: 'Analyze code structure',
        description: 'Understand codebase organization',
        priority: AssignmentPriority.HIGH,
        dependencies: []
      },
      {
        title: 'Generate API documentation',
        description: 'Create comprehensive API reference',
        priority: AssignmentPriority.HIGH,
        dependencies: ['analyze-code-structure']
      },
      {
        title: 'Create user guides',
        description: 'Generate user-facing documentation',
        priority: AssignmentPriority.MEDIUM,
        dependencies: ['analyze-code-structure']
      },
      {
        title: 'Write technical docs',
        description: 'Create technical documentation for developers',
        priority: AssignmentPriority.HIGH,
        dependencies: ['generate-api-documentation']
      },
      {
        title: 'Review and refine',
        description: 'Ensure documentation quality and completeness',
        priority: AssignmentPriority.MEDIUM,
        dependencies: ['create-user-guides', 'write-technical-docs']
      }
    ],
    toolsRequired: ['analyze-code', 'generate-docs', 'format-docs'],
    prerequisites: ['codebase-access']
  },

  [AssignmentMode.CUSTOM]: {
    mode: AssignmentMode.CUSTOM,
    name: 'Custom Workflow',
    description: 'User-defined custom assignment workflow',
    defaultSettings: {
      focusMode: true,
      autoResume: true,
      maxRetries: 3,
      checkpointsRequired: true,
      allowParallelObjectives: false,
      artifactRetention: 'summary'
    },
    defaultObjectives: [],
    toolsRequired: [],
    prerequisites: ['user-defined-objectives']
  }
};

// ============================================================================
// Assignment Manager
// ============================================================================

export class AssignmentManager {
  private assignments: Map<string, Assignment> = new Map();
  private currentAssignmentId: string | null = null;
  private storageDir: string;
  private mutex = new AsyncMutex();

  constructor() {
    this.storageDir = getStorageDirectory();
  }

  /**
   * Create a new assignment
   */
  async createAssignment(config: CreateAssignmentConfig): Promise<Assignment> {
    // Validate required fields
    if (!config.title || config.title.trim() === '') {
      throw new Error('Assignment title is required and cannot be empty');
    }
    if (!config.description || config.description.trim() === '') {
      throw new Error('Assignment description is required and cannot be empty');
    }
    // Validate mode is a valid enum value
    const validModes = Object.values(AssignmentMode);
    if (!validModes.includes(config.mode)) {
      throw new Error(`Invalid assignment mode: ${config.mode}. Valid modes: ${validModes.join(', ')}`);
    }
    // Validate duration if provided
    if (config.estimatedDuration !== undefined && config.estimatedDuration < 0) {
      throw new Error('Estimated duration cannot be negative');
    }

    const template = ASSIGNMENT_TEMPLATES[config.mode];
    const now = new Date();

    // First pass: create objectives with generated IDs
    const objectives: AssignmentObjective[] = (config.objectives || template.defaultObjectives).map((obj, index) => {
      const objective: AssignmentObjective = {
        id: this.generateObjectiveId(obj.title || '', index),
        title: obj.title || '',
        description: obj.description || '',
        completed: false,
        priority: obj.priority || AssignmentPriority.MEDIUM,
        dependencies: obj.dependencies || [],
        checkpoints: obj.checkpoints || [],
        artifacts: obj.artifacts || [],
        timestamp: {
          created: now
        }
      };
      if (obj.estimatedDuration !== undefined) {
        objective.estimatedDuration = obj.estimatedDuration;
      }
      if (obj.notes !== undefined) {
        objective.notes = obj.notes;
      }
      return objective;
    });

    // Build slug -> generated ID mapping for dependency remapping
    const slugToIdMap = new Map<string, string>();
    for (const objective of objectives) {
      const slug = this.extractSlugFromObjectiveId(objective.id);
      slugToIdMap.set(slug, objective.id);
    }

    // Second pass: remap dependencies from slugs to actual generated IDs
    for (const objective of objectives) {
      if (objective.dependencies.length > 0) {
        const remappedDeps: string[] = [];
        for (const dep of objective.dependencies) {
          // Check if dep is already a valid objective ID
          const existingObjective = objectives.find(obj => obj.id === dep);
          if (existingObjective) {
            remappedDeps.push(dep);
          } else {
            // Try to map from slug to generated ID
            const mappedId = slugToIdMap.get(dep);
            if (mappedId) {
              remappedDeps.push(mappedId);
            } else {
              // Validate: dependency references an ID that doesn't exist
              throw new Error(
                `Invalid dependency '${dep}' in objective '${objective.title}': ` +
                `no objective with ID or slug '${dep}' exists`
              );
            }
          }
        }
        objective.dependencies = remappedDeps;
      }
    }

    // Check for circular dependencies
    this.detectCircularDependencies(objectives);

    // Validate objectives
    // Custom mode must have at least 1 objective
    if (config.mode === AssignmentMode.CUSTOM && (!objectives || objectives.length === 0)) {
      throw new Error('Custom assignments must have at least one objective');
    }
    // Validate each objective has a non-empty title
    for (const obj of objectives) {
      if (!obj.title || obj.title.trim() === '') {
        throw new Error('All objectives must have a non-empty title');
      }
    }

    const metadata: AssignmentMetadata = {
      createdAt: now,
      updatedAt: now,
      createdBy: config.createdBy || 'user',
      retries: 0
    };
    if (config.assignedTo !== undefined) {
      metadata.assignedTo = config.assignedTo;
    }
    if (config.estimatedDuration !== undefined) {
      metadata.estimatedDuration = config.estimatedDuration;
    }

    const assignment: Assignment = {
      id: config.id || this.generateAssignmentId(),
      mode: config.mode,
      title: config.title,
      description: config.description,
      status: AssignmentStatus.NOT_STARTED,
      priority: config.priority || AssignmentPriority.MEDIUM,
      objectives,
      settings: config.settings ? { ...template.defaultSettings, ...config.settings } : template.defaultSettings,
      metadata,
      state: {
        currentObjectiveIndex: 0,
        completedObjectives: [],
        failedObjectives: [],
        retryCount: {},
        lastAction: 'created',
        progress: 0,
        sessionHistory: []
      }
    };

    this.assignments.set(assignment.id, assignment);
    logger.info(`Created assignment ${assignment.id}: ${assignment.title}`);

    // Persist the new assignment
    await this.saveAssignment(assignment);

    return assignment;
  }

  /**
   * Start an assignment
   */
  async startAssignment(assignmentId: string): Promise<Assignment> {
    const release = await this.mutex.acquire();
    try {
      const assignment = this.assignments.get(assignmentId);
      if (!assignment) {
        throw new Error(`Assignment ${assignmentId} not found`);
      }

      if (assignment.status !== AssignmentStatus.NOT_STARTED &&
          assignment.status !== AssignmentStatus.PAUSED) {
        throw new Error(`Assignment ${assignmentId} cannot be started (status: ${assignment.status})`);
      }

      const wasPaused = assignment.status === AssignmentStatus.PAUSED;
      assignment.status = AssignmentStatus.IN_PROGRESS;
      assignment.metadata.updatedAt = new Date();

      if (wasPaused) {
        // Resume from pause
        assignment.metadata.lastCheckpoint = new Date();
        // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
        delete assignment.state.pausedAt;
        assignment.state.resumedAt = new Date();
        assignment.state.lastAction = 'resumed';
      } else {
        // First start
        assignment.state.lastAction = 'started';
        this.startSession(assignment);
      }

      this.currentAssignmentId = assignmentId;
      this.enforceCollectionBounds(assignment);
      await this.saveAssignment(assignment);

      logger.info(`Started assignment ${assignmentId}: ${assignment.title}`);
      return assignment;
    } finally {
      release();
    }
  }

  /**
   * Resume a paused assignment
   */
  async resumeAssignment(assignmentId: string): Promise<Assignment> {
    const assignment = this.assignments.get(assignmentId);
    if (!assignment) {
      throw new Error(`Assignment ${assignmentId} not found`);
    }

    if (assignment.status !== AssignmentStatus.PAUSED) {
      throw new Error(`Assignment ${assignmentId} is not paused`);
    }

    return this.startAssignment(assignmentId);
  }

  /**
   * Pause current assignment
   */
  async pauseAssignment(): Promise<Assignment | null> {
    const release = await this.mutex.acquire();
    try {
      if (!this.currentAssignmentId) {
        return null;
      }

      const assignment = this.assignments.get(this.currentAssignmentId);
      if (!assignment) {
        return null;
      }

      assignment.status = AssignmentStatus.PAUSED;
      assignment.metadata.updatedAt = new Date();
      assignment.state.pausedAt = new Date();
      assignment.state.lastAction = 'paused';

      this.endCurrentSession(assignment);
      this.enforceCollectionBounds(assignment);
      await this.saveAssignment(assignment);

      logger.info(`Paused assignment ${assignment.id}: ${assignment.title}`);
      return assignment;
    } finally {
      release();
    }
  }

  /**
   * Complete current objective
   */
  async completeObjective(objectiveId: string, evidence?: string, notes?: string): Promise<Assignment> {
    const release = await this.mutex.acquire();
    let released = false;
    try {
      if (!this.currentAssignmentId) {
        throw new Error('No assignment in progress');
      }

      const assignment = this.assignments.get(this.currentAssignmentId);
      if (!assignment) {
        throw new Error(`Assignment ${this.currentAssignmentId} not found`);
      }

      const objective = assignment.objectives.find(obj => obj.id === objectiveId);
      if (!objective) {
        throw new Error(`Objective ${objectiveId} not found in assignment ${this.currentAssignmentId}`);
      }

      objective.completed = true;
      objective.timestamp.completed = new Date();
      if (evidence) {
        const checkpoint: AssignmentCheckpoint = {
          id: this.generateCheckpointId(),
          description: 'Objective completion evidence',
          completed: true,
          evidence,
          timestamp: new Date()
        };
        if (notes !== undefined) {
          checkpoint.notes = notes;
        }
        objective.checkpoints.push(checkpoint);
      }

      assignment.state.completedObjectives.push(objectiveId);
      assignment.state.progress = this.calculateProgress(assignment);
      assignment.state.lastAction = `completed_objective:${objectiveId}`;
      assignment.metadata.lastCheckpoint = new Date();

      this.enforceCollectionBounds(assignment);
      await this.saveAssignment(assignment);

      // Check if all objectives are completed
      if (assignment.state.progress === 100) {
        // Release mutex before calling completeAssignment to avoid deadlock
        release();
        released = true;
        await this.completeAssignment(assignment.id);
        return assignment;
      }

      logger.info(`Completed objective ${objectiveId} in assignment ${assignment.id}`);
      return assignment;
    } finally {
      if (!released) {
        release();
      }
    }
  }

  /**
   * Add checkpoint to current objective
   */
  async addCheckpoint(objectiveId: string, description: string, evidence?: string): Promise<Assignment> {
    const release = await this.mutex.acquire();
    try {
      if (!this.currentAssignmentId) {
        throw new Error('No assignment in progress');
      }

      const assignment = this.assignments.get(this.currentAssignmentId);
      if (!assignment) {
        throw new Error(`Assignment ${this.currentAssignmentId} not found`);
      }

      const objective = assignment.objectives.find(obj => obj.id === objectiveId);
      if (!objective) {
        throw new Error(`Objective ${objectiveId} not found`);
      }

      const checkpoint: AssignmentCheckpoint = {
        id: this.generateCheckpointId(),
        description,
        completed: false,
        timestamp: new Date()
      };
      if (evidence !== undefined) {
        checkpoint.evidence = evidence;
      }
      objective.checkpoints.push(checkpoint);

      assignment.metadata.lastCheckpoint = new Date();
      this.enforceCollectionBounds(assignment);
      await this.saveAssignment(assignment);

      logger.info(`Added checkpoint to objective ${objectiveId}`);
      return assignment;
    } finally {
      release();
    }
  }

  /**
   * Complete checkpoint
   */
  async completeCheckpoint(checkpointId: string, evidence?: string): Promise<Assignment> {
    const release = await this.mutex.acquire();
    try {
      if (!this.currentAssignmentId) {
        throw new Error('No assignment in progress');
      }

      const assignment = this.assignments.get(this.currentAssignmentId);
      if (!assignment) {
        throw new Error(`Assignment ${this.currentAssignmentId} not found`);
      }

      for (const objective of assignment.objectives) {
        const checkpoint = objective.checkpoints.find(cp => cp.id === checkpointId);
        if (checkpoint) {
          checkpoint.completed = true;
          if (evidence !== undefined) {
            checkpoint.evidence = evidence;
          }
          checkpoint.timestamp = new Date();
          break;
        }
      }

      assignment.metadata.lastCheckpoint = new Date();
      this.enforceCollectionBounds(assignment);
      await this.saveAssignment(assignment);

      logger.info(`Completed checkpoint ${checkpointId}`);
      return assignment;
    } finally {
      release();
    }
  }

  /**
   * Fail an objective
   */
  async failObjective(objectiveId: string, error: string): Promise<Assignment> {
    const release = await this.mutex.acquire();
    let released = false;
    try {
      if (!this.currentAssignmentId) {
        throw new Error('No assignment in progress');
      }

      const assignment = this.assignments.get(this.currentAssignmentId);
      if (!assignment) {
        throw new Error(`Assignment ${this.currentAssignmentId} not found`);
      }

      // Validate that the objective exists in the assignment
      const objective = assignment.objectives.find(obj => obj.id === objectiveId);
      if (!objective) {
        throw new Error(`Objective ${objectiveId} not found in assignment ${this.currentAssignmentId}`);
      }

      // Track per-objective retry count
      if (!assignment.state.retryCount[objectiveId]) {
        assignment.state.retryCount[objectiveId] = 0;
      }
      assignment.state.retryCount[objectiveId]++;

      assignment.state.failedObjectives.push(objectiveId);
      assignment.state.lastAction = `failed_objective:${objectiveId}`;
      assignment.metadata.updatedAt = new Date();

      const currentSession = assignment.state.sessionHistory[assignment.state.sessionHistory.length - 1];
      if (currentSession) {
        currentSession.errors.push({
          timestamp: new Date(),
          error,
          context: `Objective: ${objectiveId}`
        });
      }

      this.enforceCollectionBounds(assignment);
      await this.saveAssignment(assignment);

      // Check if max retries exceeded for this specific objective
      if (assignment.state.retryCount[objectiveId] >= assignment.settings.maxRetries) {
        // Release mutex before calling failAssignment to avoid deadlock
        release();
        released = true;
        await this.failAssignment(assignment.id, `Max retries exceeded for objective: ${objectiveId}`);
      }

      logger.error(`Failed objective ${objectiveId}: ${error}`);
      return assignment;
    } finally {
      if (!released) {
        release();
      }
    }
  }

  /**
   * Complete entire assignment
   */
  async completeAssignment(assignmentId: string): Promise<Assignment> {
    const release = await this.mutex.acquire();
    try {
      const assignment = this.assignments.get(assignmentId);
      if (!assignment) {
        throw new Error(`Assignment ${assignmentId} not found`);
      }

      assignment.status = AssignmentStatus.COMPLETED;
      assignment.metadata.updatedAt = new Date();
      assignment.metadata.actualDuration = this.calculateTotalDuration(assignment);
      assignment.state.progress = 100;
      assignment.state.lastAction = 'completed';

      this.endCurrentSession(assignment);
      this.enforceCollectionBounds(assignment);
      await this.saveAssignment(assignment);

      if (this.currentAssignmentId === assignmentId) {
        this.currentAssignmentId = null;
      }

      logger.info(`Completed assignment ${assignmentId}: ${assignment.title}`);
      return assignment;
    } finally {
      release();
    }
  }

  /**
   * Fail an assignment
   */
  async failAssignment(assignmentId: string, reason: string): Promise<Assignment> {
    const release = await this.mutex.acquire();
    try {
      const assignment = this.assignments.get(assignmentId);
      if (!assignment) {
        throw new Error(`Assignment ${assignmentId} not found`);
      }

      assignment.status = AssignmentStatus.FAILED;
      assignment.metadata.updatedAt = new Date();
      assignment.state.lastAction = 'failed';

      this.endCurrentSession(assignment);
      this.enforceCollectionBounds(assignment);
      await this.saveAssignment(assignment);

      if (this.currentAssignmentId === assignmentId) {
        this.currentAssignmentId = null;
      }

      logger.error(`Failed assignment ${assignmentId}: ${reason}`);
      return assignment;
    } finally {
      release();
    }
  }

  /**
   * Cancel an assignment
   */
  async cancelAssignment(assignmentId: string): Promise<Assignment> {
    const release = await this.mutex.acquire();
    try {
      const assignment = this.assignments.get(assignmentId);
      if (!assignment) {
        throw new Error(`Assignment ${assignmentId} not found`);
      }

      assignment.status = AssignmentStatus.CANCELLED;
      assignment.metadata.updatedAt = new Date();
      assignment.state.lastAction = 'cancelled';

      this.endCurrentSession(assignment);
      this.enforceCollectionBounds(assignment);
      await this.saveAssignment(assignment);

      if (this.currentAssignmentId === assignmentId) {
        this.currentAssignmentId = null;
      }

      logger.info(`Cancelled assignment ${assignmentId}: ${assignment.title}`);
      return assignment;
    } finally {
      release();
    }
  }

  /**
   * Get current assignment
   */
  getCurrentAssignment(): Assignment | null {
    if (!this.currentAssignmentId) {
      return null;
    }
    return this.assignments.get(this.currentAssignmentId) || null;
  }

  /**
   * Get next objective
   */
  getNextObjective(): AssignmentObjective | null {
    const assignment = this.getCurrentAssignment();
    if (!assignment) {
      return null;
    }

    // Bounds check on currentObjectiveIndex
    if (assignment.state.currentObjectiveIndex < 0 ||
        assignment.state.currentObjectiveIndex >= assignment.objectives.length) {
      // Index is out of bounds, fall through to iterate from start
    }

    for (const objective of assignment.objectives) {
      if (!objective.completed) {
        // Check dependencies
        const dependenciesMet = objective.dependencies.every(depId =>
          assignment.state.completedObjectives.includes(depId)
        );
        if (dependenciesMet) {
          return objective;
        }
      }
    }

    return null;
  }

  /**
   * Get assignment report
   */
  getAssignmentReport(assignmentId: string): AssignmentReport {
    const assignment = this.assignments.get(assignmentId);
    if (!assignment) {
      throw new Error(`Assignment ${assignmentId} not found`);
    }

    const report: AssignmentReport = {
      assignmentId: assignment.id,
      mode: assignment.mode,
      title: assignment.title,
      description: assignment.description,
      status: assignment.status,
      priority: assignment.priority,
      progress: assignment.state.progress,
      createdAt: assignment.metadata.createdAt,
      updatedAt: assignment.metadata.updatedAt,
      retries: assignment.metadata.retries,
      objectives: assignment.objectives.map(obj => {
        const reportObj: AssignmentReport['objectives'][number] = {
          id: obj.id,
          title: obj.title,
          description: obj.description,
          completed: obj.completed,
          priority: obj.priority,
          checkpointsCompleted: obj.checkpoints.filter(cp => cp.completed).length,
          totalCheckpoints: obj.checkpoints.length,
          artifacts: obj.artifacts || []
        };
        if (obj.estimatedDuration !== undefined) {
          reportObj.estimatedDuration = obj.estimatedDuration;
        }
        if (obj.actualDuration !== undefined) {
          reportObj.actualDuration = obj.actualDuration;
        }
        return reportObj;
      }),
      sessions: assignment.state.sessionHistory,
      errors: assignment.state.sessionHistory.flatMap(session => session.errors),
      artifacts: assignment.objectives.flatMap(obj => obj.artifacts || [])
    };
    if (assignment.metadata.estimatedDuration !== undefined) {
      report.estimatedDuration = assignment.metadata.estimatedDuration;
    }
    if (assignment.metadata.actualDuration !== undefined) {
      report.actualDuration = assignment.metadata.actualDuration;
    }
    return report;
  }

  /**
   * Load assignments from storage
   */
  async loadAssignments(): Promise<void> {
    logger.info('Loading assignments from storage', { storageDir: this.storageDir });

    try {
      // Ensure directory exists
      await fs.mkdir(this.storageDir, { recursive: true });

      // Read all files in the directory
      const files = await fs.readdir(this.storageDir);
      const jsonFiles = files.filter(f => f.endsWith('.json') && !f.endsWith('.tmp.json'));

      let loadedCount = 0;
      let errorCount = 0;

      for (const file of jsonFiles) {
        const filePath = path.join(this.storageDir, file);
        try {
          const content = await fs.readFile(filePath, 'utf-8');
          const parsed = JSON.parse(content) as unknown;
          const revived = reviveDates(parsed);
          const assignment = revived as Assignment;

          // Validate the assignment has required fields
          if (this.isValidAssignment(assignment)) {
            this.assignments.set(assignment.id, assignment);
            loadedCount++;
          } else {
            logger.warn(`Skipping invalid assignment file: ${file}`, {
              missingFields: this.getMissingFields(assignment)
            });
            errorCount++;
          }
        } catch (error) {
          logger.warn(`Failed to load assignment from ${file}`, { error: String(error) });
          errorCount++;
          // Continue loading other files
        }
      }

      logger.info(`Loaded ${loadedCount} assignments, ${errorCount} errors`, {
        loadedCount,
        errorCount
      });

      // Clean up stale assignments on load
      await this.cleanupStaleAssignments();
    } catch (error) {
      logger.warn('Failed to load assignments from storage', { error: String(error) });
      // Continue with empty assignments map - non-fatal
    }
  }

  /**
   * Save assignment to storage
   * Uses atomic writes: write to temp file, then rename
   */
  private async saveAssignment(assignment: Assignment): Promise<void> {
    const fileName = `${assignment.id}.json`;
    const tempFileName = `${assignment.id}.tmp.json`;
    const filePath = path.join(this.storageDir, fileName);
    const tempFilePath = path.join(this.storageDir, tempFileName);

    try {
      // Ensure directory exists
      await fs.mkdir(this.storageDir, { recursive: true });

      // Serialize with Date handling
      const serialized = JSON.stringify(assignment, dateReplacer, 2);

      // Write to temp file first (atomic write)
      await fs.writeFile(tempFilePath, serialized, 'utf-8');

      // Rename temp file to final file (atomic on most filesystems)
      await fs.rename(tempFilePath, filePath);

      logger.debug(`Saved assignment ${assignment.id} to ${filePath}`);
    } catch (error) {
      // Clean up temp file if it exists
      try {
        await fs.unlink(tempFilePath);
      } catch {
        // Ignore cleanup errors
      }

      logger.warn(`Failed to save assignment ${assignment.id}`, { error: String(error) });
      // Non-blocking: in-memory state is still correct
    }
  }

  /**
   * Delete assignment from storage
   */
  async deleteAssignment(assignmentId: string): Promise<void> {
    const fileName = `${assignmentId}.json`;
    const filePath = path.join(this.storageDir, fileName);

    try {
      await fs.unlink(filePath);
      logger.debug(`Deleted assignment file ${fileName}`);
    } catch (error) {
      // File might not exist, which is fine
      const err = error as { code?: string };
      if (err.code !== 'ENOENT') {
        logger.warn(`Failed to delete assignment file ${fileName}`, { error: String(error) });
      }
    }
  }

  /**
   * Validate assignment has required fields
   */
  private isValidAssignment(obj: unknown): obj is Assignment {
    if (typeof obj !== 'object' || obj === null) {
      return false;
    }

    const assignment = obj as Record<string, unknown>;
    const requiredFields = ['id', 'mode', 'title', 'description', 'status', 'priority', 'objectives', 'settings', 'metadata', 'state'];

    return requiredFields.every(field => field in assignment);
  }

  /**
   * Get missing fields for debugging
   */
  private getMissingFields(obj: unknown): string[] {
    if (typeof obj !== 'object' || obj === null) {
      return ['(not an object)'];
    }

    const assignment = obj as Record<string, unknown>;
    const requiredFields = ['id', 'mode', 'title', 'description', 'status', 'priority', 'objectives', 'settings', 'metadata', 'state'];

    return requiredFields.filter(field => !(field in assignment));
  }

  // ============================================================================
  // Private Helper Methods
  // ============================================================================

  /**
   * Enforce collection bounds to prevent memory leaks
   * Trims session history and errors to configured limits
   */
  private enforceCollectionBounds(assignment: Assignment): void {
    // Trim session history to keep only the last MAX_SESSION_HISTORY entries
    if (assignment.state.sessionHistory.length > MAX_SESSION_HISTORY) {
      assignment.state.sessionHistory = assignment.state.sessionHistory.slice(-MAX_SESSION_HISTORY);
    }

    // Trim errors in the current session to MAX_ERRORS_PER_SESSION
    const currentSession = assignment.state.sessionHistory[assignment.state.sessionHistory.length - 1];
    if (currentSession && currentSession.errors.length > MAX_ERRORS_PER_SESSION) {
      currentSession.errors = currentSession.errors.slice(-MAX_ERRORS_PER_SESSION);
    }
  }

  /**
   * Clean up stale completed/cancelled/failed assignments
   * Removes assignments older than retentionDays and enforces max completed assignments limit
   */
  async cleanupStaleAssignments(retentionDays: number = 30): Promise<number> {
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
    let cleaned = 0;

    const assignmentsToDelete: string[] = [];
    this.assignments.forEach((assignment, id) => {
      if ((assignment.status === AssignmentStatus.COMPLETED ||
           assignment.status === AssignmentStatus.CANCELLED ||
           assignment.status === AssignmentStatus.FAILED) &&
          assignment.metadata.updatedAt && assignment.metadata.updatedAt < cutoff) {
        assignmentsToDelete.push(id);
      }
    });

    for (const id of assignmentsToDelete) {
      this.assignments.delete(id);
      await this.deleteAssignment(id);  // Remove persisted file too
      cleaned++;
    }

    // Also enforce max completed assignments
    const completedAssignments = Array.from(this.assignments.entries())
      .filter((entry): entry is [string, Assignment] => {
        const a = entry[1];
        return a.status === AssignmentStatus.COMPLETED ||
               a.status === AssignmentStatus.CANCELLED ||
               a.status === AssignmentStatus.FAILED;
      })
      .sort((a, b) => {
        const aTime = a[1].metadata.updatedAt?.getTime() ?? 0;
        const bTime = b[1].metadata.updatedAt?.getTime() ?? 0;
        return aTime - bTime;
      });

    while (completedAssignments.length > MAX_COMPLETED_ASSIGNMENTS) {
      const [id] = completedAssignments.shift()!;
      this.assignments.delete(id);
      await this.deleteAssignment(id);
      cleaned++;
    }

    logger.info(`Cleaned up ${cleaned} stale assignments`);
    return cleaned;
  }

  private generateAssignmentId(): string {
    return `assignment_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private generateObjectiveId(title: string, index: number): string {
    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    return `objective_${slug}_${index}`;
  }

  /**
   * Extract the slug part from an objective ID
   * objective_discover-project-structure_0 -> discover-project-structure
   */
  private extractSlugFromObjectiveId(objectiveId: string): string {
    const match = objectiveId.match(/^objective_(.+)_(\d+)$/);
    if (match) {
      return match[1]!;
    }
    // Fallback: return the ID as-is if it doesn't match expected format
    return objectiveId;
  }

  /**
   * Detect circular dependencies using DFS
   * Throws an error if a cycle is detected
   */
  private detectCircularDependencies(objectives: AssignmentObjective[]): void {
    const idToObjective = new Map<string, AssignmentObjective>();
    for (const obj of objectives) {
      idToObjective.set(obj.id, obj);
    }

    const visited = new Set<string>();
    const recursionStack = new Set<string>();

    const dfs = (objectiveId: string, path: string[]): boolean => {
      visited.add(objectiveId);
      recursionStack.add(objectiveId);

      const objective = idToObjective.get(objectiveId);
      if (objective) {
        for (const depId of objective.dependencies) {
          if (!visited.has(depId)) {
            if (dfs(depId, [...path, depId])) {
              return true;
            }
          } else if (recursionStack.has(depId)) {
            // Found a cycle
            const cycleStart = path.indexOf(depId);
            const cycle = [...path.slice(cycleStart), depId];
            throw new Error(
              `Circular dependency detected: ${cycle.join(' -> ')}`
            );
          }
        }
      }

      recursionStack.delete(objectiveId);
      return false;
    };

    for (const objective of objectives) {
      if (!visited.has(objective.id)) {
        dfs(objective.id, [objective.id]);
      }
    }
  }

  private generateCheckpointId(): string {
    return `checkpoint_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private calculateProgress(assignment: Assignment): number {
    if (assignment.objectives.length === 0) return 0;
    const completed = assignment.state.completedObjectives.length;
    return Math.round((completed / assignment.objectives.length) * 100);
  }

  private calculateTotalDuration(assignment: Assignment): number {
    return assignment.state.sessionHistory.reduce((total, session) => {
      return total + (session.endedAt ? session.duration : 0);
    }, 0);
  }

  private startSession(assignment: Assignment): void {
    const session: AssignmentSession = {
      id: this.generateSessionId(),
      startedAt: new Date(),
      duration: 0,
      objectivesAttempted: [],
      objectivesCompleted: [],
      errors: []
    };
    assignment.state.sessionHistory.push(session);
  }

  private endCurrentSession(assignment: Assignment): void {
    const currentSession = assignment.state.sessionHistory[assignment.state.sessionHistory.length - 1];
    if (currentSession) {
      currentSession.endedAt = new Date();
      currentSession.duration = currentSession.endedAt.getTime() - currentSession.startedAt.getTime();
    }
  }

  private generateSessionId(): string {
    return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

// ============================================================================
// Type Definitions
// ============================================================================

export interface CreateAssignmentConfig {
  mode: AssignmentMode;
  title: string;
  description: string;
  priority?: AssignmentPriority;
  objectives?: Partial<AssignmentObjective>[];
  settings?: Partial<AssignmentSettings>;
  estimatedDuration?: number;
  createdBy?: string;
  assignedTo?: string;
  id?: string;
}

export interface AssignmentReport {
  assignmentId: string;
  mode: AssignmentMode;
  title: string;
  description: string;
  status: AssignmentStatus;
  priority: AssignmentPriority;
  progress: number;
  createdAt: Date;
  updatedAt: Date;
  estimatedDuration?: number;
  actualDuration?: number;
  retries: number;
  objectives: Array<{
    id: string;
    title: string;
    description: string;
    completed: boolean;
    priority: AssignmentPriority;
    checkpointsCompleted: number;
    totalCheckpoints: number;
    estimatedDuration?: number;
    actualDuration?: number;
    artifacts: string[];
  }>;
  sessions: AssignmentSession[];
  errors: Array<{
    timestamp: Date;
    error: string;
    context: string;
  }>;
  artifacts: string[];
}

// Export singleton instance
export const assignmentManager = new AssignmentManager();