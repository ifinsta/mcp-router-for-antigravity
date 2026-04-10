/**
 * Advanced Interaction Patterns
 *
 * Provides complex user interaction capabilities including drag and drop,
 * file upload simulation, right-click, double-click, keyboard shortcuts,
 * and sophisticated element interactions.
 */

import type { CDPClient } from './cdpClient.js';
import { getLogger } from '../infra/logger.js';

const logger = getLogger('advanced-interactions');

// ============================================================================
// Types
// ============================================================================

/**
 * Drag and drop configuration
 */
export interface DragDropConfig {
  sourceSelector: string;
  targetSelector: string;
  steps?: number;
  delay?: number;
  holdDuration?: number;
}

/**
 * File upload configuration
 */
export interface FileUploadConfig {
  selector: string;
  files: FileUploadFile[];
  triggerMethod?: 'input' | 'drag_drop' | 'click';
}

/**
 * File upload file
 */
export interface FileUploadFile {
  name: string;
  content: string | Buffer;
  mimeType?: string;
  size: number;
}

/**
 * Right-click configuration
 */
export interface RightClickConfig {
  selector: string;
  button?: 'right' | 'middle';
  modifiers?: {
    ctrl?: boolean;
    shift?: boolean;
    alt?: boolean;
    meta?: boolean;
  };
}

/**
 * Double-click configuration
 */
export interface DoubleClickConfig {
  selector: string;
  interval?: number;
}

/**
 * Keyboard shortcut configuration
 */
export interface KeyboardShortcutConfig {
  keys: string;
  modifiers?: {
    ctrl?: boolean;
    shift?: boolean;
    alt?: boolean;
    meta?: boolean;
  };
  element?: string;
}

/**
 * Hover configuration
 */
export interface HoverConfig {
  selector: string;
  duration?: number;
  xOffset?: number;
  yOffset?: number;
}

/**
 * Scroll to element configuration
 */
export interface ScrollToElementConfig {
  selector: string;
  behavior?: 'auto' | 'smooth' | 'instant';
  block?: 'start' | 'center' | 'end' | 'nearest';
  inline?: 'start' | 'center' | 'end' | 'nearest';
}

/**
 * Multi-select configuration
 */
export interface MultiSelectConfig {
  selector: string;
  items: string[];
  selectionMethod?: 'click' | 'ctrl_click' | 'shift_click';
  deselectAllFirst?: boolean;
}

/**
 * Form fill configuration
 */
export interface FormFillConfig {
  formSelector?: string;
  fields: Record<string, {
    value: string;
    type?: 'text' | 'select' | 'checkbox' | 'radio' | 'file';
    selector?: string;
  }>;
  submitAfter?: boolean;
  submitSelector?: string;
}

/**
 * Mouse movement configuration
 */
export interface MouseMovementConfig {
  fromSelector?: string;
  toSelector?: string;
  steps?: number;
  duration?: number;
  path?: Array<{ x: number; y: number }>;
}

// ============================================================================
// Advanced Interactions Manager
// ============================================================================

/**
 * Advanced Interactions Manager
 *
 * Manages complex user interactions beyond basic clicking and typing.
 */
export class AdvancedInteractionsManager {
  private cdpClient: CDPClient | null = null;

  constructor(cdpClient: CDPClient | null = null) {
    this.cdpClient = cdpClient;
  }

  /**
   * Set CDP client
   */
  setCDPClient(client: CDPClient): void {
    this.cdpClient = client;
  }

  /**
   * Drag and drop operation
   */
  async dragDrop(config: DragDropConfig): Promise<void> {
    if (!this.cdpClient) {
      throw new Error('CDP client not set for advanced interactions');
    }

    logger.info('Starting drag and drop operation', {
      source: config.sourceSelector,
      target: config.targetSelector,
    });

    const script = `
      (async function() {
        const source = document.querySelector('${config.sourceSelector}');
        const target = document.querySelector('${config.targetSelector}');

        if (!source) throw new Error('Source element not found: ${config.sourceSelector}');
        if (!target) throw new Error('Target element not found: ${config.targetSelector}');

        const sourceRect = source.getBoundingClientRect();
        const targetRect = target.getBoundingClientRect();

        const steps = ${config.steps ?? 10};
        const delay = ${config.delay ?? 50};
        const holdDuration = ${config.holdDuration ?? 100};

        // Simulate mouse down on source
        const mouseDownEvent = new MouseEvent('mousedown', {
          bubbles: true,
          cancelable: true,
          view: window,
          clientX: sourceRect.left + sourceRect.width / 2,
          clientY: sourceRect.top + sourceRect.height / 2,
          button: 0,
        });
        source.dispatchEvent(mouseDownEvent);

        await new Promise(r => setTimeout(r, holdDuration));

        // Simulate drag start
        const dragStartEvent = new DragEvent('dragstart', {
          bubbles: true,
          cancelable: true,
          dataTransfer: new DataTransfer(),
        });
        source.dispatchEvent(dragStartEvent);

        // Simulate mouse movement from source to target
        const startX = sourceRect.left + sourceRect.width / 2;
        const startY = sourceRect.top + sourceRect.height / 2;
        const endX = targetRect.left + targetRect.width / 2;
        const endY = targetRect.top + targetRect.height / 2;

        for (let i = 0; i <= steps; i++) {
          const progress = i / steps;
          const x = startX + (endX - startX) * progress;
          const y = startY + (endY - startY) * progress;

          const mouseMoveEvent = new MouseEvent('mousemove', {
            bubbles: true,
            cancelable: true,
            view: window,
            clientX: x,
            clientY: y,
            button: 0,
          });
          document.dispatchEvent(mouseMoveEvent);

          const dragOverEvent = new DragEvent('dragover', {
            bubbles: true,
            cancelable: true,
            clientX: x,
            clientY: y,
          });
          target.dispatchEvent(dragOverEvent);

          if (i < steps) {
            await new Promise(r => setTimeout(r, delay));
          }
        }

        // Simulate drop on target
        const dropEvent = new DragEvent('drop', {
          bubbles: true,
          cancelable: true,
          clientX: endX,
          clientY: endY,
        });
        target.dispatchEvent(dropEvent);

        // Simulate mouse up on target
        const mouseUpEvent = new MouseEvent('mouseup', {
          bubbles: true,
          cancelable: true,
          view: window,
          clientX: endX,
          clientY: endY,
          button: 0,
        });
        target.dispatchEvent(mouseUpEvent);

        // Simulate drag end
        const dragEndEvent = new DragEvent('dragend', {
          bubbles: true,
          cancelable: true,
        });
        source.dispatchEvent(dragEndEvent);

        return { success: true };
      })()
    `;

    try {
      const result = await this.cdpClient.executeScript(script, {
        returnByValue: true,
        awaitPromise: true,
      });

      logger.info('Drag and drop completed successfully', result as Record<string, unknown> | undefined);
    } catch (error) {
      logger.error('Drag and drop failed', error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  /**
   * File upload operation
   */
  async fileUpload(config: FileUploadConfig): Promise<void> {
    if (!this.cdpClient) {
      throw new Error('CDP client not set for advanced interactions');
    }

    logger.info('Starting file upload operation', {
      selector: config.selector,
      fileCount: config.files.length,
      method: config.triggerMethod,
    });

    const triggerMethod = config.triggerMethod ?? 'input';

    // Convert files to base64 for transfer
    const filesData = config.files.map(file => ({
      name: file.name,
      content: Buffer.isBuffer(file.content) ? file.content.toString('base64') : btoa(file.content),
      mimeType: file.mimeType || 'text/plain',
      size: file.size,
    }));

    const script = `
      (async function() {
        const selector = '${config.selector}';
        const filesData = ${JSON.stringify(filesData)};
        const method = '${triggerMethod}';

        const input = document.querySelector(selector);

        if (!input) {
          throw new Error('File input element not found: ' + selector);
        }

        // Check if it's a file input
        if (input.type !== 'file') {
          throw new Error('Element is not a file input: ' + selector);
        }

        // Create File objects from data
        const files = filesData.map(fileData => {
          const content = atob(fileData.content);
          const array = new Uint8Array(content.length);
          for (let i = 0; i < content.length; i++) {
            array[i] = content.charCodeAt(i);
          }

          return new File([array], fileData.name, { type: fileData.mimeType });
        });

        // Create DataTransfer and add files
        const dataTransfer = new DataTransfer();
        files.forEach(file => {
          dataTransfer.items.add(file);
        });

        // Set files to input
        input.files = dataTransfer.files;

        // Trigger change event
        const changeEvent = new Event('change', { bubbles: true });
        input.dispatchEvent(changeEvent);

        // Handle different trigger methods
        if (method === 'drag_drop') {
          // Simulate drag and drop
          const rect = input.getBoundingClientRect();
          const dropEvent = new DragEvent('drop', {
            bubbles: true,
            cancelable: true,
            dataTransfer: dataTransfer,
            clientX: rect.left + rect.width / 2,
            clientY: rect.top + rect.height / 2,
          });
          input.dispatchEvent(dropEvent);
        } else if (method === 'click') {
          // Click input to open file dialog
          const clickEvent = new MouseEvent('click', {
            bubbles: true,
            cancelable: true,
          });
          input.dispatchEvent(clickEvent);
        }

        return { success: true, filesUploaded: files.length };
      })()
    `;

    try {
      const result = await this.cdpClient.executeScript(script, {
        returnByValue: true,
        awaitPromise: true,
      });

      logger.info('File upload completed successfully', result as Record<string, unknown> | undefined);
    } catch (error) {
      logger.error('File upload failed', error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  /**
   * Right-click operation
   */
  async rightClick(config: RightClickConfig): Promise<void> {
    if (!this.cdpClient) {
      throw new Error('CDP client not set for advanced interactions');
    }

    logger.info('Starting right-click operation', {
      selector: config.selector,
      button: config.button,
    });

    const script = `
      (async function() {
        const element = document.querySelector('${config.selector}');

        if (!element) {
          throw new Error('Element not found: ${config.selector}');
        }

        const rect = element.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;

        const modifiers = ${JSON.stringify(config.modifiers ?? {})};

        // Create mouse events
        const button = ${config.button === 'middle' ? 1 : 2}; // 1 = middle, 2 = right
        const buttons = 1 << button;

        const options = {
          bubbles: true,
          cancelable: true,
          view: window,
          clientX: x,
          clientY: y,
          button: button,
          buttons: buttons,
          ctrlKey: modifiers.ctrl ?? false,
          shiftKey: modifiers.shift ?? false,
          altKey: modifiers.alt ?? false,
          metaKey: modifiers.meta ?? false,
        };

        // Mouse down
        const mouseDownEvent = new MouseEvent('mousedown', options);
        element.dispatchEvent(mouseDownEvent);

        // Context menu
        const contextMenuEvent = new MouseEvent('contextmenu', options);
        element.dispatchEvent(contextMenuEvent);

        // Mouse up
        const mouseUpEvent = new MouseEvent('mouseup', options);
        element.dispatchEvent(mouseUpEvent);

        return { success: true, x, y };
      })()
    `;

    try {
      const result = await this.cdpClient.executeScript(script, {
        returnByValue: true,
        awaitPromise: true,
      });

      logger.info('Right-click completed successfully', result as Record<string, unknown> | undefined);
    } catch (error) {
      logger.error('Right-click failed', error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  /**
   * Double-click operation
   */
  async doubleClick(config: DoubleClickConfig): Promise<void> {
    if (!this.cdpClient) {
      throw new Error('CDP client not set for advanced interactions');
    }

    logger.info('Starting double-click operation', {
      selector: config.selector,
      interval: config.interval,
    });

    const script = `
      (async function() {
        const element = document.querySelector('${config.selector}');

        if (!element) {
          throw new Error('Element not found: ${config.selector}');
        }

        const rect = element.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;
        const interval = ${config.interval ?? 100};

        const options = {
          bubbles: true,
          cancelable: true,
          view: window,
          clientX: x,
          clientY: y,
          button: 0,
          buttons: 1,
        };

        // First click
        const click1Event = new MouseEvent('mousedown', options);
        element.dispatchEvent(click1Event);

        const click1UpEvent = new MouseEvent('mouseup', options);
        element.dispatchEvent(click1UpEvent);

        const dblClickEvent1 = new MouseEvent('click', options);
        element.dispatchEvent(dblClickEvent1);

        // Wait interval
        await new Promise(r => setTimeout(r, interval));

        // Second click (completes double-click)
        const click2Event = new MouseEvent('mousedown', options);
        element.dispatchEvent(click2Event);

        const click2UpEvent = new MouseEvent('mouseup', options);
        element.dispatchEvent(click2UpEvent);

        const dblClickEvent2 = new MouseEvent('click', options);
        element.dispatchEvent(dblClickEvent2);

        // Dispatch dblclick event
        const dblClickEvent = new MouseEvent('dblclick', options);
        element.dispatchEvent(dblClickEvent);

        return { success: true, x, y };
      })()
    `;

    try {
      const result = await this.cdpClient.executeScript(script, {
        returnByValue: true,
        awaitPromise: true,
      });

      logger.info('Double-click completed successfully', result as Record<string, unknown> | undefined);
    } catch (error) {
      logger.error('Double-click failed', error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  /**
   * Keyboard shortcut operation
   */
  async keyboardShortcut(config: KeyboardShortcutConfig): Promise<void> {
    if (!this.cdpClient) {
      throw new Error('CDP client not set for advanced interactions');
    }

    logger.info('Executing keyboard shortcut', {
      keys: config.keys,
      modifiers: config.modifiers,
    });

    const script = `
      (async function() {
        const keys = '${config.keys}';
        const modifiers = ${JSON.stringify(config.modifiers ?? {})};
        const element = ${config.element ? `document.querySelector('${config.element}')` : 'document.activeElement'};

        const keyMap = {
          'Enter': 'Enter',
          'Escape': 'Escape',
          'Tab': 'Tab',
          'Space': ' ',
          'ArrowUp': 'ArrowUp',
          'ArrowDown': 'ArrowDown',
          'ArrowLeft': 'ArrowLeft',
          'ArrowRight': 'ArrowRight',
          'PageUp': 'PageUp',
          'PageDown': 'PageDown',
          'Home': 'Home',
          'End': 'End',
        };

        const options = {
          bubbles: true,
          cancelable: true,
          key: keyMap[keys] || keys,
          code: keys,
          ctrlKey: modifiers.ctrl ?? false,
          shiftKey: modifiers.shift ?? false,
          altKey: modifiers.alt ?? false,
          metaKey: modifiers.meta ?? false,
        };

        // Key down
        const keyDownEvent = new KeyboardEvent('keydown', options);
        if (element) {
          element.dispatchEvent(keyDownEvent);
        } else {
          document.dispatchEvent(keyDownEvent);
        }

        // Key press
        const keyPressEvent = new KeyboardEvent('keypress', options);
        if (element) {
          element.dispatchEvent(keyPressEvent);
        } else {
          document.dispatchEvent(keyPressEvent);
        }

        // Key up
        const keyUpEvent = new KeyboardEvent('keyup', options);
        if (element) {
          element.dispatchEvent(keyUpEvent);
        } else {
          document.dispatchEvent(keyUpEvent);
        }

        return { success: true, keys };
      })()
    `;

    try {
      const result = await this.cdpClient.executeScript(script, {
        returnByValue: true,
        awaitPromise: true,
      });

      logger.info('Keyboard shortcut executed successfully', result as Record<string, unknown> | undefined);
    } catch (error) {
      logger.error('Keyboard shortcut failed', error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  /**
   * Hover operation
   */
  async hover(config: HoverConfig): Promise<void> {
    if (!this.cdpClient) {
      throw new Error('CDP client not set for advanced interactions');
    }

    logger.info('Starting hover operation', {
      selector: config.selector,
      duration: config.duration,
    });

    const script = `
      (async function() {
        const element = document.querySelector('${config.selector}');

        if (!element) {
          throw new Error('Element not found: ${config.selector}');
        }

        const rect = element.getBoundingClientRect();
        const duration = ${config.duration ?? 1000};

        const x = rect.left + rect.width / 2 + ${config.xOffset ?? 0};
        const y = rect.top + rect.height / 2 + ${config.yOffset ?? 0};

        const options = {
          bubbles: true,
          cancelable: true,
          view: window,
          clientX: x,
          clientY: y,
          button: 0,
          buttons: 0,
        };

        // Mouse move over element
        const mouseMoveEvent = new MouseEvent('mousemove', options);
        element.dispatchEvent(mouseMoveEvent);

        // Mouse enter
        const mouseEnterEvent = new MouseEvent('mouseenter', options);
        element.dispatchEvent(mouseEnterEvent);

        // Mouse over
        const mouseOverEvent = new MouseEvent('mouseover', options);
        element.dispatchEvent(mouseOverEvent);

        // Wait duration
        await new Promise(r => setTimeout(r, duration));

        // Mouse leave
        const mouseLeaveEvent = new MouseEvent('mouseleave', options);
        element.dispatchEvent(mouseLeaveEvent);

        // Mouse out
        const mouseOutEvent = new MouseEvent('mouseout', options);
        element.dispatchEvent(mouseOutEvent);

        return { success: true, x, y, duration };
      })()
    `;

    try {
      const result = await this.cdpClient.executeScript(script, {
        returnByValue: true,
        awaitPromise: true,
      });

      logger.info('Hover completed successfully', result as Record<string, unknown> | undefined);
    } catch (error) {
      logger.error('Hover failed', error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  /**
   * Scroll to element operation
   */
  async scrollToElement(config: ScrollToElementConfig): Promise<void> {
    if (!this.cdpClient) {
      throw new Error('CDP client not set for advanced interactions');
    }

    logger.info('Scrolling to element', {
      selector: config.selector,
      behavior: config.behavior,
    });

    const script = `
      (function() {
        const element = document.querySelector('${config.selector}');

        if (!element) {
          throw new Error('Element not found: ${config.selector}');
        }

        element.scrollIntoView({
          behavior: '${config.behavior ?? 'auto'}',
          block: '${config.block ?? 'nearest'}',
          inline: '${config.inline ?? 'nearest'}',
        });

        return { success: true };
      })()
    `;

    try {
      const result = await this.cdpClient.executeScript(script, {
        returnByValue: true,
      });

      logger.info('Scroll to element completed successfully', result as Record<string, unknown> | undefined);
    } catch (error) {
      logger.error('Scroll to element failed', error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  /**
   * Multi-select operation
   */
  async multiSelect(config: MultiSelectConfig): Promise<void> {
    if (!this.cdpClient) {
      throw new Error('CDP client not set for advanced interactions');
    }

    logger.info('Starting multi-select operation', {
      selector: config.selector,
      itemCount: config.items.length,
      method: config.selectionMethod,
    });

    const script = `
      (async function() {
        const selector = '${config.selector}';
        const items = ${JSON.stringify(config.items)};
        const method = '${config.selectionMethod ?? 'click'}';
        const deselectAll = ${config.deselectAllFirst ?? false};

        // Get all matching elements
        const elements = Array.from(document.querySelectorAll(selector));

        if (elements.length === 0) {
          throw new Error('No elements found matching: ' + selector);
        }

        // If deselecting all first
        if (deselectAll) {
          elements.forEach(el => {
            el.classList.remove('selected');
            el.setAttribute('aria-selected', 'false');
          });
        }

        // Select items based on method
        for (const item of items) {
          const element = document.querySelector(item);

          if (!element) {
            console.warn('Element not found for selection: ' + item);
            continue;
          }

          const rect = element.getBoundingClientRect();
          const x = rect.left + rect.width / 2;
          const y = rect.top + rect.height / 2;

          const options = {
            bubbles: true,
            cancelable: true,
            view: window,
            clientX: x,
            clientY: y,
            button: 0,
            buttons: 1,
            ctrlKey: method === 'ctrl_click',
            shiftKey: method === 'shift_click',
          };

          // Click or Ctrl+Click or Shift+Click
          const clickEvent = new MouseEvent('click', options);
          element.dispatchEvent(clickEvent);

          // Wait between selections
          await new Promise(r => setTimeout(r, 100));

          // Add selected class
          element.classList.add('selected');
          element.setAttribute('aria-selected', 'true');
        }

        return { success: true, selectedCount: items.length };
      })()
    `;

    try {
      const result = await this.cdpClient.executeScript(script, {
        returnByValue: true,
        awaitPromise: true,
      });

      logger.info('Multi-select completed successfully', result as Record<string, unknown> | undefined);
    } catch (error) {
      logger.error('Multi-select failed', error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  /**
   * Form fill operation
   */
  async formFill(config: FormFillConfig): Promise<void> {
    if (!this.cdpClient) {
      throw new Error('CDP client not set for advanced interactions');
    }

    logger.info('Starting form fill operation', {
      formSelector: config.formSelector,
      fieldCount: Object.keys(config.fields).length,
      submitAfter: config.submitAfter,
    });

    const script = `
      (async function() {
        const formSelector = ${config.formSelector ? `'${config.formSelector}'` : 'null'};
        const fields = ${JSON.stringify(config.fields)};

        const form = formSelector ? document.querySelector(formSelector) : document;
        if (!form) {
          throw new Error('Form not found: ' + (formSelector || 'document.body'));
        }

        // Fill each field
        for (const [fieldName, fieldConfig] of Object.entries(fields)) {
          const fieldSelector = fieldConfig.selector || ('[name="' + fieldName + '"]');
          const field = form.querySelector(fieldSelector);

          if (!field) {
            console.warn('Field not found: ' + fieldSelector);
            continue;
          }

          const fieldType = fieldConfig.type || 'text';

          switch (fieldType) {
            case 'text':
            case 'password':
            case 'email':
            case 'tel':
            case 'number':
              field.value = fieldConfig.value;
              field.dispatchEvent(new Event('input', { bubbles: true }));
              field.dispatchEvent(new Event('change', { bubbles: true }));
              break;

            case 'select':
              field.value = fieldConfig.value;
              field.dispatchEvent(new Event('change', { bubbles: true }));
              break;

            case 'checkbox':
            case 'radio':
              field.checked = fieldConfig.value === 'true' || fieldConfig.value === true;
              field.dispatchEvent(new Event('change', { bubbles: true }));
              break;

            case 'file':
              // File upload handled separately
              break;
          }

          // Small delay between fields
          await new Promise(r => setTimeout(r, 50));
        }

        // Submit form if requested
        if (${config.submitAfter ?? false}) {
          const submitSelector = ${config.submitSelector ? `'${config.submitSelector}'` : 'null'};
          const submitButton = submitSelector ? form.querySelector(submitSelector) : form.querySelector('button[type="submit"], input[type="submit"]');

          if (submitButton) {
            submitButton.click();
          } else {
            form.submit();
          }
        }

        return { success: true, fieldsFilled: Object.keys(fields).length };
      })()
    `;

    try {
      const result = await this.cdpClient.executeScript(script, {
        returnByValue: true,
        awaitPromise: true,
      });

      logger.info('Form fill completed successfully', result as Record<string, unknown> | undefined);
    } catch (error) {
      logger.error('Form fill failed', error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  /**
   * Mouse movement operation
   */
  async mouseMovement(config: MouseMovementConfig): Promise<void> {
    if (!this.cdpClient) {
      throw new Error('CDP client not set for advanced interactions');
    }

    logger.info('Starting mouse movement operation', {
      from: config.fromSelector,
      to: config.toSelector,
      steps: config.steps,
    });

    const script = `
      (async function() {
        const steps = ${config.steps ?? 10};
        const duration = ${config.duration ?? 1000};
        const stepDelay = duration / steps;

        let fromRect, toRect;

        // Get coordinates
        if ('${config.fromSelector}') {
          const fromElement = document.querySelector('${config.fromSelector}');
          if (!fromElement) throw new Error('From element not found: ${config.fromSelector}');
          fromRect = fromElement.getBoundingClientRect();
        } else {
          fromRect = { left: 0, top: 0, width: 0, height: 0 };
        }

        if ('${config.toSelector}') {
          const toElement = document.querySelector('${config.toSelector}');
          if (!toElement) throw new Error('To element not found: ${config.toSelector}');
          toRect = toElement.getBoundingClientRect();
        } else {
          toRect = { left: 0, top: 0, width: 0, height: 0 };
        }

        // Use custom path if provided
        const customPath = ${config.path ? JSON.stringify(config.path) : 'null'};

        const path = customPath || Array.from({ length: steps + 1 }, (_, i) => ({
          x: fromRect.left + (toRect.left - fromRect.left) * (i / steps),
          y: fromRect.top + (toRect.top - fromRect.top) * (i / steps),
        }));

        // Animate mouse movement
        for (let i = 0; i < path.length; i++) {
          const { x, y } = path[i];

          const options = {
            bubbles: true,
            cancelable: true,
            view: window,
            clientX: x,
            clientY: y,
            button: 0,
            buttons: 0,
          };

          const mouseMoveEvent = new MouseEvent('mousemove', options);
          document.dispatchEvent(mouseMoveEvent);

          if (i < path.length - 1) {
            await new Promise(r => setTimeout(r, stepDelay));
          }
        }

        return { success: true, points: path.length };
      })()
    `;

    try {
      const result = await this.cdpClient.executeScript(script, {
        returnByValue: true,
        awaitPromise: true,
      });

      logger.info('Mouse movement completed successfully', result as Record<string, unknown> | undefined);
    } catch (error) {
      logger.error('Mouse movement failed', error instanceof Error ? error.message : String(error));
      throw error;
    }
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Create advanced interactions manager
 */
export function createAdvancedInteractionsManager(cdpClient: CDPClient | null = null): AdvancedInteractionsManager {
  return new AdvancedInteractionsManager(cdpClient);
}

/**
 * Create base64 file content
 */
export function createBase64File(content: string): string {
  return Buffer.from(content).toString('base64');
}

/**
 * Get file MIME type
 */
export function getFileMimeType(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase();
  const mimeTypes: Record<string, string> = {
    'txt': 'text/plain',
    'html': 'text/html',
    'css': 'text/css',
    'js': 'application/javascript',
    'json': 'application/json',
    'pdf': 'application/pdf',
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'png': 'image/png',
    'gif': 'image/gif',
    'svg': 'image/svg+xml',
  };
  return mimeTypes[ext || ''] || 'application/octet-stream';
}