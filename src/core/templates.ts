/**
 * Prompt Template Registry
 *
 * Provides a registry of reusable prompt templates with variable substitution.
 * Templates with outputFormat "json" can be paired with StructuredOutputProcessor
 * for auto-validation of responses.
 */

import type { PromptTemplate, TemplateRenderResult, NormalizedChatRequest } from './types.js';
import { createRouterError, ErrorCode } from './types.js';
import { PERFORMANCE_TEMPLATES } from './performanceTemplates.js';

// ============================================================================
// Built-in Templates
// ============================================================================

const BUILTIN_TEMPLATES: readonly PromptTemplate[] = [
  ...PERFORMANCE_TEMPLATES,
  {
    name: 'react-component',
    description: 'Generate a clean, well-typed React TypeScript component with proper props, hooks, and accessibility.',
    category: 'frontend',
    systemPrompt:
      'You are an expert React TypeScript developer. Generate clean, well-typed React components with proper props interfaces, hooks usage, and accessibility attributes.',
    userPromptTemplate:
      'Create a React component named {{name}} with the following props: {{props}}. Include a TypeScript props interface, use functional component syntax, add JSDoc comments, and ensure proper accessibility with ARIA attributes.',
    variables: ['name', 'props'],
  },
  {
    name: 'css-to-tailwind',
    description: 'Convert CSS to equivalent Tailwind CSS utility classes.',
    category: 'frontend',
    systemPrompt:
      'You are a CSS and Tailwind CSS expert. Convert CSS to equivalent Tailwind utility classes accurately.',
    userPromptTemplate:
      "Convert the following CSS to Tailwind CSS classes. Provide the Tailwind classes and explain any conversions that aren't direct mappings:\n\n{{css}}",
    variables: ['css'],
  },
  {
    name: 'typescript-interface',
    description: 'Generate precise, well-documented TypeScript interfaces from a description or JSON example.',
    category: 'typescript',
    systemPrompt:
      'You are a TypeScript expert. Generate precise, well-documented TypeScript interfaces.',
    userPromptTemplate:
      "Generate a TypeScript interface based on this description: {{description}}. Include JSDoc comments for each property. Use strict types (no 'any'). If the input is a JSON example, infer the types from the values.",
    variables: ['description'],
    outputFormat: 'json',
  },
  {
    name: 'unit-test',
    description: 'Write comprehensive unit tests covering happy paths, edge cases, and error conditions.',
    category: 'testing',
    systemPrompt:
      'You are a testing expert. Write comprehensive unit tests that cover happy paths, edge cases, and error conditions.',
    userPromptTemplate:
      'Write unit tests for the following code:\n\n{{code}}\n\nUse {{framework}} testing framework. Include tests for: normal operation, edge cases, error handling, and boundary conditions.',
    variables: ['code', 'framework'],
  },
  {
    name: 'refactor-accessibility',
    description: 'Refactor code for better accessibility following WCAG 2.1 AA standards.',
    category: 'accessibility',
    systemPrompt:
      'You are a web accessibility expert following WCAG 2.1 AA standards. Refactor code to improve accessibility.',
    userPromptTemplate:
      'Refactor the following code for better accessibility (WCAG 2.1 AA compliance):\n\n{{code}}\n\nAdd proper ARIA attributes, semantic HTML, keyboard navigation, focus management, and screen reader support. Explain each change.',
    variables: ['code'],
  },
  {
    name: 'code-review',
    description: 'Analyze code for bugs, performance issues, security vulnerabilities, and accessibility problems.',
    category: 'review',
    systemPrompt:
      'You are a senior code reviewer. Analyze code for bugs, performance issues, security vulnerabilities, and accessibility problems. Be specific and actionable.',
    userPromptTemplate:
      'Review the following {{language}} code. Identify: bugs, performance issues, security concerns, accessibility problems, and suggest improvements with code examples:\n\n{{code}}',
    variables: ['language', 'code'],
  },
  {
    name: 'explain-code',
    description: 'Explain code clearly for developers of all skill levels.',
    category: 'learning',
    systemPrompt:
      'You are a patient technical educator. Explain code clearly for developers of all skill levels.',
    userPromptTemplate:
      'Explain the following code in plain language. Cover: what it does, how it works step by step, key patterns used, and any potential issues:\n\n{{code}}',
    variables: ['code'],
  },
  {
    name: 'json-mock-data',
    description: 'Generate realistic, diverse mock JSON data matching a given schema or description.',
    category: 'data',
    systemPrompt:
      'You are a data generation expert. Create realistic, diverse mock data that matches the given schema or description. Use realistic names, dates, addresses, and values.',
    userPromptTemplate:
      'Generate {{count}} items of realistic mock JSON data matching this description: {{description}}. Make the data diverse and realistic.',
    variables: ['count', 'description'],
    outputFormat: 'json',
  },
] as const;

// ============================================================================
// Template Registry
// ============================================================================

/**
 * Registry for prompt templates.
 *
 * Provides lookup, listing, and rendering of prompt templates with
 * {{variable}} substitution. Loaded with 8 built-in templates at construction.
 */
export class TemplateRegistry {
  private readonly templates: Map<string, PromptTemplate>;

  constructor() {
    this.templates = new Map<string, PromptTemplate>();
    for (const template of BUILTIN_TEMPLATES) {
      this.templates.set(template.name, template);
    }
  }

  /**
   * Get a template by name.
   * @returns The template, or undefined if not found.
   */
  get(name: string): PromptTemplate | undefined {
    return this.templates.get(name);
  }

  /**
   * List all registered templates.
   */
  list(): PromptTemplate[] {
    return Array.from(this.templates.values());
  }

  /**
   * Render a template with variable substitution.
   *
   * Substitutes all `{{varName}}` placeholders in both systemPrompt and
   * userPromptTemplate with the provided values.
   *
   * @param name - Template name
   * @param vars - Variable values keyed by variable name
   * @returns Rendered messages, outputFormat, and optional schema/model
   * @throws RouterError if template not found or required variables missing
   */
  render(name: string, vars: Record<string, string>): TemplateRenderResult {
    const template = this.templates.get(name);
    if (template === undefined) {
      throw createRouterError(
        ErrorCode.VALIDATION_ERROR,
        `Template not found: "${name}"`,
        { context: { templateName: name } },
      );
    }

    // Validate all required variables are provided
    const missingVars: string[] = [];
    for (const varName of template.variables) {
      if (!(varName in vars)) {
        missingVars.push(varName);
      }
    }

    if (missingVars.length > 0) {
      throw createRouterError(
        ErrorCode.MISSING_REQUIRED_FIELD,
        `Missing required template variables: ${missingVars.join(', ')}`,
        { context: { templateName: name, missingVariables: missingVars } },
      );
    }

    // Perform substitution
    const renderedSystem = substituteVariables(template.systemPrompt, vars);
    const renderedUser = substituteVariables(template.userPromptTemplate, vars);

    const messages: NormalizedChatRequest['messages'] = [
      { role: 'system', content: renderedSystem },
      { role: 'user', content: renderedUser },
    ];

    const result: TemplateRenderResult = {
      messages,
      outputFormat: template.outputFormat ?? 'text',
    };

    if (template.schema !== undefined) {
      result.schema = template.schema;
    }

    if (template.recommendedModel !== undefined) {
      result.recommendedModel = template.recommendedModel;
    }

    return result;
  }
}

// ============================================================================
// Variable Substitution
// ============================================================================

/**
 * Replace all `{{varName}}` placeholders in text with values from vars.
 */
function substituteVariables(
  text: string,
  vars: Record<string, string>,
): string {
  return text.replace(/\{\{(\w+)\}\}/g, (_match, varName: string) => {
    const value = vars[varName];
    // If variable is provided, use its value; otherwise keep the placeholder
    return value !== undefined ? value : `{{${varName}}}`;
  });
}

// ============================================================================
// Singleton
// ============================================================================

let registryInstance: TemplateRegistry | undefined;

/**
 * Get the singleton TemplateRegistry instance.
 */
export function getTemplateRegistry(): TemplateRegistry {
  if (registryInstance === undefined) {
    registryInstance = new TemplateRegistry();
  }
  return registryInstance;
}
