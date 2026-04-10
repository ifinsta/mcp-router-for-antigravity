import React, { useEffect, useState } from 'react';
import './types';
import './assignments.css';

interface AssignmentObjective {
  id: string;
  title: string;
  description: string;
  completed: boolean;
  priority: 'critical' | 'high' | 'medium' | 'low';
  checkpoints: Array<{
    id: string;
    description: string;
    completed: boolean;
    timestamp: Date;
  }>;
}

interface Assignment {
  id: string;
  mode: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  objectives: AssignmentObjective[];
  state: {
    progress: number;
    currentObjectiveIndex: number;
  };
}

function getAssignmentProgress(assignment: Assignment): number {
  return typeof assignment.state?.progress === 'number' ? assignment.state.progress : 0;
}

function getCurrentObjective(assignment: Assignment): AssignmentObjective | null {
  const indexedObjective = assignment.objectives[assignment.state?.currentObjectiveIndex ?? 0];
  if (indexedObjective && !indexedObjective.completed) {
    return indexedObjective;
  }

  return assignment.objectives.find((objective) => !objective.completed) ?? null;
}

export default function Assignments() {
  const [activeTab, setActiveTab] = useState('active');
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [selectedAssignment, setSelectedAssignment] = useState<Assignment | null>(null);
  const [currentObjective, setCurrentObjective] = useState<AssignmentObjective | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadAssignments();
  }, []);

  const loadAssignments = async () => {
    setLoading(true);
    setError(null);

    try {
      const result = await window.electronAPI.assignmentAPI.list();
      if (result.success && result.assignments) {
        setAssignments(result.assignments);
        if (result.assignments.length > 0) {
          setSelectedAssignment(result.assignments[0]);
          setCurrentObjective(getCurrentObjective(result.assignments[0]));
        }
      } else {
        setError(result.error || 'Failed to load assignments');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load assignments');
    } finally {
      setLoading(false);
    }
  };

  const createAssignment = async (mode: string) => {
    setLoading(true);
    setError(null);

    try {
      const config = {
        mode,
        title: `${mode.charAt(0).toUpperCase() + mode.slice(1)} Assignment`,
        description: `Assignment created for ${mode} mode`,
        priority: 'medium',
      };
      const result = await window.electronAPI.assignmentAPI.create(config);
      if (result.success && result.assignment) {
        setAssignments((prev) => [...prev, result.assignment]);
        setSelectedAssignment(result.assignment);
        setCurrentObjective(getCurrentObjective(result.assignment));
        setActiveTab('details');
      } else {
        setError(result.error || 'Failed to create assignment');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create assignment');
    } finally {
      setLoading(false);
    }
  };

  const startAssignment = async (assignmentId: string) => {
    setLoading(true);
    setError(null);

    try {
      const result = await window.electronAPI.assignmentAPI.start(assignmentId);
      if (result.success && result.assignment) {
        setAssignments((prev) => prev.map((assignment) => (assignment.id === result.assignment.id ? result.assignment : assignment)));
        setSelectedAssignment(result.assignment);
        setCurrentObjective(getCurrentObjective(result.assignment));
      } else {
        setError(result.error || 'Failed to start assignment');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start assignment');
    } finally {
      setLoading(false);
    }
  };

  const pauseAssignment = async (assignmentId: string) => {
    setLoading(true);
    setError(null);

    try {
      const result = await window.electronAPI.assignmentAPI.pause(assignmentId);
      if (result.success && result.assignment) {
        setAssignments((prev) => prev.map((assignment) => (assignment.id === result.assignment.id ? result.assignment : assignment)));
        setSelectedAssignment(result.assignment);
        setCurrentObjective(getCurrentObjective(result.assignment));
      } else {
        setError(result.error || 'Failed to pause assignment');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to pause assignment');
    } finally {
      setLoading(false);
    }
  };

  const resumeAssignment = async (assignmentId: string) => {
    setLoading(true);
    setError(null);

    try {
      const result = await window.electronAPI.assignmentAPI.resume(assignmentId);
      if (result.success && result.assignment) {
        setAssignments((prev) => prev.map((assignment) => (assignment.id === result.assignment.id ? result.assignment : assignment)));
        setSelectedAssignment(result.assignment);
        setCurrentObjective(getCurrentObjective(result.assignment));
      } else {
        setError(result.error || 'Failed to resume assignment');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to resume assignment');
    } finally {
      setLoading(false);
    }
  };

  const completeObjective = async (objectiveId: string) => {
    if (!selectedAssignment) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const result = await window.electronAPI.assignmentAPI.completeObjective(selectedAssignment.id, objectiveId);
      if (result.success && result.assignment) {
        setAssignments((prev) => prev.map((assignment) => (assignment.id === result.assignment.id ? result.assignment : assignment)));
        setSelectedAssignment(result.assignment);
        setCurrentObjective(getCurrentObjective(result.assignment));
      } else {
        setError(result.error || 'Failed to complete objective');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to complete objective');
    } finally {
      setLoading(false);
    }
  };

  const addCheckpoint = async (objectiveId: string) => {
    if (!selectedAssignment) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const description = `Checkpoint added at ${new Date().toISOString()}`;
      const result = await window.electronAPI.assignmentAPI.addCheckpoint(objectiveId, description);
      if (result.success && result.assignment) {
        setAssignments((prev) => prev.map((assignment) => (assignment.id === result.assignment.id ? result.assignment : assignment)));
        setSelectedAssignment(result.assignment);
        setCurrentObjective(getCurrentObjective(result.assignment));
      } else {
        setError(result.error || 'Failed to add checkpoint');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add checkpoint');
    } finally {
      setLoading(false);
    }
  };

  const cancelAssignment = async (assignmentId: string) => {
    setLoading(true);
    setError(null);

    try {
      const result = await window.electronAPI.assignmentAPI.cancel(assignmentId);
      if (result.success && result.assignment) {
        setAssignments((prev) => prev.map((assignment) => (assignment.id === result.assignment.id ? result.assignment : assignment)));
        setSelectedAssignment(result.assignment);
        setCurrentObjective(getCurrentObjective(result.assignment));
      } else {
        setError(result.error || 'Failed to cancel assignment');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to cancel assignment');
    } finally {
      setLoading(false);
    }
  };

  const getReport = async (assignmentId: string) => {
    setLoading(true);
    setError(null);

    try {
      const result = await window.electronAPI.assignmentAPI.getReport(assignmentId);
      if (result.success && result.report) {
        console.log('Assignment Report:', result.report);
        alert(`Report generated. Progress: ${result.report.progress}%`);
      } else {
        setError(result.error || 'Failed to get report');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to get report');
    } finally {
      setLoading(false);
    }
  };

  const renderActiveAssignments = () => (
    <div className="assignments-list">
      {assignments.length === 0 && <div className="empty-state">No assignments found. Create one to get started.</div>}
      {assignments.map((assignment) => (
        <div key={assignment.id} className="assignment-card">
          <div className="assignment-header">
            <div className="assignment-info">
              <h3>{assignment.title}</h3>
              <span className={`assignment-mode ${assignment.mode}`}>{assignment.mode.toUpperCase()}</span>
              <span className={`assignment-status ${assignment.status}`}>{assignment.status.replace('_', ' ').toUpperCase()}</span>
            </div>

            <div className="assignment-progress">
              <div className="progress-bar">
                <div className="progress-fill" style={{ width: `${getAssignmentProgress(assignment)}%` }} />
              </div>
              <div className="progress-meta">
                <span className="progress-text">{getAssignmentProgress(assignment)}% complete</span>
                <span className="progress-note">
                  {getCurrentObjective(assignment)?.title || 'No active objective'}
                </span>
              </div>
            </div>

            <div className="assignment-actions">
              {assignment.status === 'not_started' && (
                <button type="button" className="btn-primary" onClick={() => startAssignment(assignment.id)} disabled={loading}>
                  Start
                </button>
              )}

              {assignment.status === 'in_progress' && (
                <>
                  <button type="button" className="btn-warning" onClick={() => pauseAssignment(assignment.id)} disabled={loading}>
                    Pause
                  </button>
                  <button
                    type="button"
                    className="btn-info"
                    onClick={() => {
                      setSelectedAssignment(assignment);
                      setActiveTab('details');
                    }}
                    disabled={loading}
                  >
                    Details
                  </button>
                </>
              )}

              {assignment.status === 'paused' && (
                <button type="button" className="btn-primary" onClick={() => resumeAssignment(assignment.id)} disabled={loading}>
                  Resume
                </button>
              )}
            </div>
          </div>

          <div className="assignment-details">
            <p>{assignment.description}</p>

            <div className="objectives-summary">
              <span>
                Objectives: {assignment.objectives.filter((objective) => objective.completed).length}/{assignment.objectives.length}
              </span>
              <span className={`priority-${assignment.priority}`}>Priority: {assignment.priority.toUpperCase()}</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );

  const renderAssignmentDetails = () => {
    if (!selectedAssignment) {
      return <div className="empty-state">No assignment selected.</div>;
    }

    return (
      <div className="assignment-details-panel">
        <div className="details-header">
          <h2>{selectedAssignment.title}</h2>
          <div className="header-actions">
            <button type="button" className="btn-secondary">
              Clone
            </button>
            <button type="button" className="btn-secondary">
              Export
            </button>
          </div>
        </div>

        <div className="assignment-overview">
          <div className="overview-item">
            <span className="label">Status</span>
            <span className={`value status-${selectedAssignment.status}`}>{selectedAssignment.status.replace('_', ' ').toUpperCase()}</span>
          </div>
          <div className="overview-item">
            <span className="label">Progress</span>
            <span className="value">{getAssignmentProgress(selectedAssignment)}%</span>
          </div>
          <div className="overview-item">
            <span className="label">Mode</span>
            <span className="value">{selectedAssignment.mode.toUpperCase()}</span>
          </div>
          <div className="overview-item">
            <span className="label">Priority</span>
            <span className={`value priority-${selectedAssignment.priority}`}>{selectedAssignment.priority.toUpperCase()}</span>
          </div>
        </div>

        <div className="objectives-list">
          <h3>Objectives</h3>
          {selectedAssignment.objectives.map((objective, index) => (
            <div
              key={objective.id}
              className={`objective-item ${objective.completed ? 'completed' : ''} ${currentObjective?.id === objective.id ? 'current' : ''}`}
            >
              <div className="objective-header">
                <div className="objective-number">{index + 1}</div>
                <div className="objective-info">
                  <h4>{objective.title}</h4>
                  <span className={`objective-priority priority-${objective.priority}`}>{objective.priority.toUpperCase()}</span>
                </div>
                <div className="objective-status">
                  {objective.completed ? (
                    <span className="status-completed">Completed</span>
                  ) : currentObjective?.id === objective.id ? (
                    <span className="status-current">Current</span>
                  ) : (
                    <span className="status-pending">Pending</span>
                  )}
                </div>
              </div>

              <div className="objective-description">{objective.description}</div>

              {objective.checkpoints.length > 0 && (
                <div className="checkpoints-list">
                  <h5>
                    Checkpoints ({objective.checkpoints.filter((checkpoint) => checkpoint.completed).length}/{objective.checkpoints.length})
                  </h5>
                  {objective.checkpoints.map((checkpoint) => (
                    <div key={checkpoint.id} className={`checkpoint-item ${checkpoint.completed ? 'completed' : ''}`}>
                      <span className="checkpoint-status" aria-hidden="true">
                        {checkpoint.completed ? 'Done' : 'Open'}
                      </span>
                      <span className="checkpoint-description">{checkpoint.description}</span>
                    </div>
                  ))}
                </div>
              )}

              {!objective.completed && currentObjective?.id === objective.id && (
                <div className="objective-actions">
                  <button type="button" className="btn-primary" onClick={() => completeObjective(objective.id)} disabled={loading}>
                    Complete Objective
                  </button>
                  <button type="button" className="btn-secondary" onClick={() => addCheckpoint(objective.id)} disabled={loading}>
                    Add Checkpoint
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="assignment-actions-panel">
          <button type="button" className="btn-primary" onClick={() => getReport(selectedAssignment.id)} disabled={loading}>
            Generate Report
          </button>
          {selectedAssignment.status === 'in_progress' && (
            <button type="button" className="btn-secondary" onClick={() => pauseAssignment(selectedAssignment.id)} disabled={loading}>
              Pause Assignment
            </button>
          )}
          {selectedAssignment.status === 'paused' && (
            <button type="button" className="btn-primary" onClick={() => resumeAssignment(selectedAssignment.id)} disabled={loading}>
              Resume Assignment
            </button>
          )}
          <button type="button" className="btn-danger" onClick={() => cancelAssignment(selectedAssignment.id)} disabled={loading}>
            Cancel Assignment
          </button>
        </div>
      </div>
    );
  };

  const renderCreateAssignment = () => {
    const templates = [
      { mode: 'explorer', title: 'Codebase Explorer', description: 'Discover and map codebase structure, URLs, and relationships.', meta: '4 Objectives', duration: '~30 min' },
      { mode: 'tester', title: 'Comprehensive Tester', description: 'Run systematic testing across discovered endpoints and workflows.', meta: '5 Objectives', duration: '~45 min' },
      { mode: 'auditor', title: 'Security Auditor', description: 'Review the codebase for security and compliance gaps.', meta: '5 Objectives', duration: '~60 min' },
      { mode: 'benchmarker', title: 'Performance Benchmarker', description: 'Measure runtime behavior and capture benchmark data.', meta: '5 Objectives', duration: '~40 min' },
      { mode: 'migrator', title: 'Code Migrator', description: 'Coordinate migration and refactoring tasks across the codebase.', meta: '5 Objectives', duration: '~60 min' },
      { mode: 'optimizer', title: 'Performance Optimizer', description: 'Refine code paths for better efficiency and responsiveness.', meta: '4 Objectives', duration: '~45 min' },
      { mode: 'documenter', title: 'Documentation Generator', description: 'Produce implementation and operating documentation.', meta: '5 Objectives', duration: '~50 min' },
      { mode: 'custom', title: 'Custom Assignment', description: 'Create a tailored workflow for a specific operating need.', meta: 'Custom', duration: 'Variable', custom: true },
    ];

    return (
      <div className="create-assignment-panel">
        <h2>Create New Assignment</h2>

        <div className="assignment-templates">
          {templates.map((template) => (
            <button
              key={template.mode}
              type="button"
              className={`template-card ${template.custom ? 'custom' : ''}`}
              onClick={() => createAssignment(template.mode)}
              disabled={loading}
              aria-label={`Create ${template.title}`}
            >
              <h3>{template.title}</h3>
              <p>{template.description}</p>
              <div className="template-info">
                <span>{template.meta}</span>
                <span>{template.duration}</span>
              </div>
            </button>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="assignments-container">
      {loading && (
        <div className="loading-overlay" role="status" aria-live="polite">
          <div className="loading-spinner">Loading...</div>
        </div>
      )}

      {error && (
        <div className="error-banner" role="alert">
          <span className="error-message">{error}</span>
          <button type="button" className="error-dismiss" onClick={() => setError(null)} aria-label="Dismiss error">
            Close
          </button>
        </div>
      )}

      <nav className="assignments-nav">
        <button type="button" className={`nav-item ${activeTab === 'active' ? 'active' : ''}`} onClick={() => setActiveTab('active')}>
          Active Assignments
        </button>
        <button type="button" className={`nav-item ${activeTab === 'create' ? 'active' : ''}`} onClick={() => setActiveTab('create')}>
          Create Assignment
        </button>
        {selectedAssignment && (
          <button type="button" className={`nav-item ${activeTab === 'details' ? 'active' : ''}`} onClick={() => setActiveTab('details')}>
            Assignment Details
          </button>
        )}
      </nav>

      <main className="assignments-main">
        {activeTab === 'active' && renderActiveAssignments()}
        {activeTab === 'create' && renderCreateAssignment()}
        {activeTab === 'details' && renderAssignmentDetails()}
      </main>
    </div>
  );
}
