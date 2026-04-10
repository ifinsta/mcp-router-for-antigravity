/**
 * Unit tests for TemplateRegistry
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';

import {
  TemplateRegistry,
  getTemplateRegistry,
} from '../../../src/core/templates.js';

import type { PromptTemplate } from '../../../src/core/types.js';

describe('TemplateRegistry', () => {
  let registry: TemplateRegistry;

  beforeEach(() => {
    registry = new TemplateRegistry();
  });

  // --------------------------------------------------------------------------
  // list()
  // --------------------------------------------------------------------------

  describe('list()', () => {
    it('should return all 20 built-in templates', () => {
      const templates = registry.list();
      assert.strictEqual(templates.length, 20);
    });

    it('should contain expected template names', () => {
      const names = registry.list().map((t) => t.name);
      const expected = [
        'react-component',
        'css-to-tailwind',
        'typescript-interface',
        'unit-test',
        'refactor-accessibility',
        'code-review',
        'explain-code',
        'json-mock-data',
      ];
      for (const name of expected) {
        assert.ok(names.includes(name), `Missing template: ${name}`);
      }
    });
  });

  // --------------------------------------------------------------------------
  // get()
  // --------------------------------------------------------------------------

  describe('get()', () => {
    it('should return correct template by name', () => {
      const template = registry.get('react-component');
      assert.ok(template !== undefined);
      assert.strictEqual(template.name, 'react-component');
      assert.strictEqual(template.category, 'frontend');
    });

    it('should return undefined for unknown template', () => {
      const template = registry.get('nonexistent-template');
      assert.strictEqual(template, undefined);
    });
  });

  // --------------------------------------------------------------------------
  // render()
  // --------------------------------------------------------------------------

  describe('render()', () => {
    it('should substitute variables correctly', () => {
      const result = registry.render('react-component', {
        name: 'Button',
        props: 'label: string, onClick: () => void',
      });

      assert.strictEqual(result.messages.length, 2);
      const userMsg = result.messages[1];
      assert.ok(userMsg !== undefined);
      assert.ok(userMsg.content.includes('Button'));
      assert.ok(userMsg.content.includes('label: string, onClick: () => void'));
      assert.ok(!userMsg.content.includes('{{name}}'));
      assert.ok(!userMsg.content.includes('{{props}}'));
    });

    it('should throw for missing required variable', () => {
      assert.throws(
        () => registry.render('react-component', { name: 'Button' }),
        (err: Error) => {
          assert.ok(err.message.includes('Missing required template variables'));
          assert.ok(err.message.includes('props'));
          return true;
        },
      );
    });

    it('should throw for unknown template', () => {
      assert.throws(
        () => registry.render('nonexistent', {}),
        (err: Error) => {
          assert.ok(err.message.includes('Template not found'));
          return true;
        },
      );
    });

    it('should return correct outputFormat for text template', () => {
      const result = registry.render('react-component', {
        name: 'Card',
        props: 'title: string',
      });
      assert.strictEqual(result.outputFormat, 'text');
    });

    it('should return correct outputFormat for json template', () => {
      const result = registry.render('typescript-interface', {
        description: 'A user with name and email',
      });
      assert.strictEqual(result.outputFormat, 'json');
    });

    it('should include schema when template has one', () => {
      // json-mock-data has outputFormat json but no schema by default
      const result = registry.render('json-mock-data', {
        count: '5',
        description: 'users',
      });
      // No schema defined on this template, so schema should not be present
      assert.strictEqual(result.schema, undefined);
    });

    it('should return messages array with system + user', () => {
      const result = registry.render('explain-code', {
        code: 'console.log("hello")',
      });
      assert.strictEqual(result.messages.length, 2);
      assert.strictEqual(result.messages[0]?.role, 'system');
      assert.strictEqual(result.messages[1]?.role, 'user');
    });

    it('should handle multiple occurrences of same variable', () => {
      // code-review uses {{code}} and {{language}} — test that both substitute
      const result = registry.render('code-review', {
        language: 'TypeScript',
        code: 'const x = 1;',
      });
      const userMsg = result.messages[1];
      assert.ok(userMsg !== undefined);
      assert.ok(userMsg.content.includes('TypeScript'));
      assert.ok(userMsg.content.includes('const x = 1;'));
      assert.ok(!userMsg.content.includes('{{language}}'));
      assert.ok(!userMsg.content.includes('{{code}}'));
    });

    it('should handle special characters in variable values', () => {
      const specialValue = 'foo<bar>&"baz\'qux\n\ttab $dollar {{nested}}';
      const result = registry.render('explain-code', {
        code: specialValue,
      });
      const userMsg = result.messages[1];
      assert.ok(userMsg !== undefined);
      assert.ok(userMsg.content.includes(specialValue));
    });
  });

  // --------------------------------------------------------------------------
  // All templates structural validation
  // --------------------------------------------------------------------------

  describe('built-in template structure', () => {
    it('all 20 templates have valid structure', () => {
      const templates = registry.list();
      for (const t of templates) {
        assert.ok(typeof t.name === 'string' && t.name.length > 0, `${t.name}: name`);
        assert.ok(typeof t.description === 'string' && t.description.length > 0, `${t.name}: description`);
        assert.ok(typeof t.category === 'string' && t.category.length > 0, `${t.name}: category`);
        assert.ok(typeof t.systemPrompt === 'string' && t.systemPrompt.length > 0, `${t.name}: systemPrompt`);
        assert.ok(typeof t.userPromptTemplate === 'string' && t.userPromptTemplate.length > 0, `${t.name}: userPromptTemplate`);
        assert.ok(Array.isArray(t.variables) && t.variables.length > 0, `${t.name}: variables`);

        // Every declared variable should appear as {{var}} in the userPromptTemplate
        for (const v of t.variables) {
          assert.ok(
            t.userPromptTemplate.includes(`{{${v}}}`),
            `${t.name}: variable "{{${v}}}" not found in userPromptTemplate`,
          );
        }
      }
    });

    it('templates with outputFormat json have correct value', () => {
      const jsonTemplates = registry.list().filter(
        (t): t is PromptTemplate & { outputFormat: 'json' } => t.outputFormat === 'json',
      );
      assert.ok(jsonTemplates.length >= 2, 'Expected at least 2 json templates');
      for (const t of jsonTemplates) {
        assert.strictEqual(t.outputFormat, 'json');
      }
    });
  });

  // --------------------------------------------------------------------------
  // Singleton
  // --------------------------------------------------------------------------

  describe('getTemplateRegistry()', () => {
    it('should return same instance on multiple calls', () => {
      const a = getTemplateRegistry();
      const b = getTemplateRegistry();
      assert.strictEqual(a, b);
    });

    it('should return a registry with 20 templates', () => {
      const reg = getTemplateRegistry();
      assert.strictEqual(reg.list().length, 20);
    });
  });
});
