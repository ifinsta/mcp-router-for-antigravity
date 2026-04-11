/**
 * Unit tests for WorkflowRecorder
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';

import {
  WorkflowRecorder,
  getWorkflowRecorder,
} from '../../../src/core/workflowRecorder.js';
import type { RecordedAction } from '../../../src/core/types.js';
import { createRecordedAction } from './fixtures.js';

describe('WorkflowRecorder', () => {
  let recorder: WorkflowRecorder;

  beforeEach(() => {
    recorder = new WorkflowRecorder();
  });

  describe('startRecording', () => {
    it('should start a new recording and return workflow ID', () => {
      const id = recorder.startRecording('Test Workflow');

      assert.ok(id);
      assert.ok(id.startsWith('wf_'));
      assert.ok(id.length > 3);
    });

    it('should create independent workflows for each call', () => {
      const id1 = recorder.startRecording('Workflow 1');
      const id2 = recorder.startRecording('Workflow 2');

      assert.notStrictEqual(id1, id2);
    });

    it('should stop previous active recording when starting new one', () => {
      const id1 = recorder.startRecording('First');
      recorder.recordAction(id1, createRecordedAction('click'));

      const id2 = recorder.startRecording('Second');

      // First workflow should be stopped
      assert.throws(() => {
        recorder.recordAction(id1, createRecordedAction('click'));
      }, /already been stopped/);

      // Second workflow should be active
      assert.doesNotThrow(() => {
        recorder.recordAction(id2, createRecordedAction('click'));
      });
    });
  });

  describe('stopRecording', () => {
    it('should stop recording and return completed workflow', () => {
      const id = recorder.startRecording('Test');
      recorder.recordAction(id, createRecordedAction('click'));
      recorder.recordAction(id, createRecordedAction('type'));

      const workflow = recorder.stopRecording(id);

      assert.strictEqual(workflow.id, id);
      assert.strictEqual(workflow.name, 'Test');
      assert.ok(workflow.startedAt);
      assert.ok(workflow.endedAt);
      assert.strictEqual(workflow.actions.length, 2);
    });

    it('should throw error for non-existent workflow', () => {
      assert.throws(() => {
        recorder.stopRecording('non-existent-id');
      }, /Workflow not found/);
    });

    it('should include generated code in stopped workflow', () => {
      const id = recorder.startRecording('Test');
      recorder.recordAction(id, createRecordedAction('navigate', { url: 'https://example.com' }));
      recorder.recordAction(id, createRecordedAction('click', { selector: '#btn' }));

      const workflow = recorder.stopRecording(id);

      assert.ok(workflow.generatedCode);
      assert.ok(workflow.generatedCode.length > 0);
      assert.ok(workflow.generatedCode.includes('browser.'));
    });

    it('should include generated assertions in stopped workflow', () => {
      const id = recorder.startRecording('Test');
      recorder.recordAction(id, createRecordedAction('navigate', { url: 'https://example.com' }));

      const workflow = recorder.stopRecording(id);

      assert.ok(Array.isArray(workflow.generatedAssertions));
      assert.ok(workflow.generatedAssertions.length > 0);
    });
  });

  describe('recordAction', () => {
    it('should record action in active workflow', () => {
      const id = recorder.startRecording('Test');
      const action = createRecordedAction('click', { selector: '#submit' });

      recorder.recordAction(id, action);

      const workflow = recorder.stopRecording(id);
      assert.strictEqual(workflow.actions.length, 1);
      assert.strictEqual(workflow.actions[0]?.type, 'click');
    });

    it('should throw error for non-existent workflow', () => {
      assert.throws(() => {
        recorder.recordAction('non-existent', createRecordedAction());
      }, /Workflow not found/);
    });

    it('should throw error for stopped workflow', () => {
      const id = recorder.startRecording('Test');
      recorder.stopRecording(id);

      assert.throws(() => {
        recorder.recordAction(id, createRecordedAction());
      }, /already been stopped/);
    });

    it('should record multiple actions in order', () => {
      const id = recorder.startRecording('Test');

      recorder.recordAction(id, createRecordedAction('navigate', { url: 'https://example.com' }));
      recorder.recordAction(id, createRecordedAction('click', { selector: '#btn1' }));
      recorder.recordAction(id, createRecordedAction('type', { selector: '#input', value: 'text' }));
      recorder.recordAction(id, createRecordedAction('click', { selector: '#btn2' }));

      const workflow = recorder.stopRecording(id);

      assert.strictEqual(workflow.actions.length, 4);
      assert.strictEqual(workflow.actions[0]?.type, 'navigate');
      assert.strictEqual(workflow.actions[1]?.type, 'click');
      assert.strictEqual(workflow.actions[2]?.type, 'type');
      assert.strictEqual(workflow.actions[3]?.type, 'click');
    });
  });

  describe('getWorkflow', () => {
    it('should retrieve workflow by ID', () => {
      const id = recorder.startRecording('Test');
      recorder.recordAction(id, createRecordedAction());

      const workflow = recorder.getWorkflow(id);

      assert.ok(workflow);
      assert.strictEqual(workflow?.id, id);
      assert.strictEqual(workflow?.name, 'Test');
    });

    it('should return undefined for non-existent workflow', () => {
      const workflow = recorder.getWorkflow('non-existent');
      assert.strictEqual(workflow, undefined);
    });

    it('should return workflow with generated code', () => {
      const id = recorder.startRecording('Test');
      recorder.recordAction(id, createRecordedAction('click'));

      const workflow = recorder.getWorkflow(id);

      assert.ok(workflow?.generatedCode);
      assert.ok(workflow?.generatedAssertions);
    });
  });

  describe('listWorkflows', () => {
    it('should return empty array when no workflows', () => {
      const workflows = recorder.listWorkflows();
      assert.ok(Array.isArray(workflows));
      assert.strictEqual(workflows.length, 0);
    });

    it('should list all workflows sorted by last accessed', () => {
      const id1 = recorder.startRecording('First');
      const id2 = recorder.startRecording('Second');
      const id3 = recorder.startRecording('Third');

      // Access first workflow to update its timestamp
      recorder.getWorkflow(id1);

      const workflows = recorder.listWorkflows();

      assert.strictEqual(workflows.length, 3);
      // Most recently accessed should be first
      assert.strictEqual(workflows[0]?.id, id1);
    });

    it('should include all workflow fields', () => {
      const id = recorder.startRecording('Test');
      recorder.recordAction(id, createRecordedAction());
      recorder.stopRecording(id);

      const workflows = recorder.listWorkflows();

      assert.strictEqual(workflows.length, 1);
      assert.ok(workflows[0]?.id);
      assert.ok(workflows[0]?.name);
      assert.ok(workflows[0]?.startedAt);
      assert.ok(workflows[0]?.endedAt);
      assert.ok(Array.isArray(workflows[0]?.actions));
      assert.ok(typeof workflows[0]?.generatedCode === 'string');
      assert.ok(Array.isArray(workflows[0]?.generatedAssertions));
    });
  });

  describe('generateCode', () => {
    it('should generate browser.* calls for actions', () => {
      const id = recorder.startRecording('Test');
      recorder.recordAction(id, createRecordedAction('navigate', { url: 'https://example.com' }));
      recorder.recordAction(id, createRecordedAction('click', { selector: '#btn' }));
      recorder.recordAction(id, createRecordedAction('type', { selector: '#input', value: 'hello' }));

      const code = recorder.generateCode(id);

      assert.ok(code.includes('browser.navigate'));
      assert.ok(code.includes('browser.click'));
      assert.ok(code.includes('browser.type'));
    });

    it('should include workflow name in generated code', () => {
      const id = recorder.startRecording('My Test Workflow');
      const code = recorder.generateCode(id);

      assert.ok(code.includes('My Test Workflow'));
    });

    it('should throw error for non-existent workflow', () => {
      assert.throws(() => {
        recorder.generateCode('non-existent');
      }, /Workflow not found/);
    });

    it('should handle all action types', () => {
      const id = recorder.startRecording('Test');

      recorder.recordAction(id, createRecordedAction('click'));
      recorder.recordAction(id, createRecordedAction('type'));
      recorder.recordAction(id, createRecordedAction('navigate'));
      recorder.recordAction(id, createRecordedAction('select'));
      recorder.recordAction(id, createRecordedAction('scroll'));
      recorder.recordAction(id, createRecordedAction('wait'));
      recorder.recordAction(id, createRecordedAction('screenshot'));
      recorder.recordAction(id, createRecordedAction('assert'));

      const code = recorder.generateCode(id);

      assert.ok(code.includes('click'));
      assert.ok(code.includes('type'));
      assert.ok(code.includes('navigate'));
      assert.ok(code.includes('screenshot'));
    });

    it('should escape special characters in selectors and values', () => {
      const id = recorder.startRecording('Test');
      recorder.recordAction(id, createRecordedAction('type', {
        selector: "input[name='test']",
        value: "It's a test",
      }));

      const code = recorder.generateCode(id);

      assert.ok(code.includes('input[name=\\\'test\\\']') || code.includes("input[name='test']"));
    });
  });

  describe('generateAssertions', () => {
    it('should generate assertions for navigate actions', () => {
      const id = recorder.startRecording('Test');
      recorder.recordAction(id, createRecordedAction('navigate', { url: 'https://example.com' }));

      const assertions = recorder.generateAssertions(id);

      assert.ok(assertions.some((a) => a.includes('page.url()')));
      assert.ok(assertions.some((a) => a.includes('https://example.com')));
    });

    it('should generate assertions for click actions', () => {
      const id = recorder.startRecording('Test');
      recorder.recordAction(id, createRecordedAction('click', { selector: '#btn' }));

      const assertions = recorder.generateAssertions(id);

      assert.ok(assertions.some((a) => a.includes('querySelector')));
      assert.ok(assertions.some((a) => a.includes('#btn')));
    });

    it('should generate assertions for type actions', () => {
      const id = recorder.startRecording('Test');
      recorder.recordAction(id, createRecordedAction('type', { selector: '#input', value: 'test value' }));

      const assertions = recorder.generateAssertions(id);

      assert.ok(assertions.some((a) => a.includes('value')));
      assert.ok(assertions.some((a) => a.includes('test value')));
    });

    it('should generate assertions for select actions', () => {
      const id = recorder.startRecording('Test');
      recorder.recordAction(id, createRecordedAction('select', { selector: '#dropdown', value: 'option1' }));

      const assertions = recorder.generateAssertions(id);

      assert.ok(assertions.length > 0);
    });

    it('should throw error for non-existent workflow', () => {
      assert.throws(() => {
        recorder.generateAssertions('non-existent');
      }, /Workflow not found/);
    });
  });

  describe('LRU eviction (max 50 workflows)', () => {
    it('should evict oldest workflow when exceeding max', () => {
      const ids: string[] = [];

      // Create 51 workflows
      for (let i = 0; i < 51; i++) {
        const id = recorder.startRecording(`Workflow ${i}`);
        ids.push(id);
      }

      const workflows = recorder.listWorkflows();
      assert.strictEqual(workflows.length, 50);

      // First workflow should be evicted
      assert.strictEqual(recorder.getWorkflow(ids[0]), undefined);

      // Most recent should exist
      assert.ok(recorder.getWorkflow(ids[50]));
    });

    it('should maintain exactly 50 workflows at capacity', () => {
      for (let i = 0; i < 50; i++) {
        recorder.startRecording(`Workflow ${i}`);
      }

      const workflows = recorder.listWorkflows();
      assert.strictEqual(workflows.length, 50);
    });
  });

  describe('edge cases', () => {
    it('should handle empty workflow (no actions)', () => {
      const id = recorder.startRecording('Empty');
      const workflow = recorder.stopRecording(id);

      assert.strictEqual(workflow.actions.length, 0);
      assert.ok(workflow.generatedCode);
    });

    it('should handle workflow with only special characters in name', () => {
      const id = recorder.startRecording('Test \' " \\n Workflow');
      const workflow = recorder.getWorkflow(id);

      assert.ok(workflow);
      assert.strictEqual(workflow?.name, 'Test \' " \\n Workflow');
    });

    it('should handle action with undefined optional fields', () => {
      const id = recorder.startRecording('Test');
      const action: RecordedAction = {
        type: 'click',
        timestamp: new Date().toISOString(),
        // selector is undefined
      };

      recorder.recordAction(id, action);
      const workflow = recorder.stopRecording(id);

      assert.strictEqual(workflow.actions.length, 1);
      assert.strictEqual(workflow.actions[0]?.selector, undefined);
    });
  });

  describe('singleton', () => {
    it('getWorkflowRecorder should return same instance', () => {
      const instance1 = getWorkflowRecorder();
      const instance2 = getWorkflowRecorder();
      assert.strictEqual(instance1, instance2);
    });
  });
});
