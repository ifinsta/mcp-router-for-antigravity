# Tool Proxy Requirements Document

## Executive Summary

**🎉 CORRECTION TO PREVIOUS ANALYSIS**: The VS Code Language Model API **DOES** support tools for third-party providers! Our custom models CAN use tools, but we must implement the tool calling loop ourselves.

**Evidence**: Antigravity is built on VS Code 1.107+, which provides:
- `options.tools` parameter in `provideLanguageModelChatResponse()`
- `lm.tools` registry with all available tools
- `lm.invokeTool()` function to execute tools
- `LanguageModelToolCallPart` for tool call requests
- `LanguageModelToolResultPart` for tool results

---

## Evidence from Installed Antigravity Version

### VS Code API Version: 1.107.0+

**Source**: `C:\Users\user\AppData\Local\Programs\Antigravity\resources\app\out\vscode-dts\vscode.d.ts`

### Key API Discovery #1: Tools ARE Passed to Providers

```typescript
// Line 20588-20611
export interface ProvideLanguageModelChatResponseOptions {
  readonly modelOptions?: { readonly [name: string]: any };
  
  // ✅ TOOLS ARE AVAILABLE!
  readonly tools?: readonly LanguageModelChatTool[];
  
  readonly toolMode: LanguageModelChatToolMode;
}
```

**Evidence**: The `tools` parameter exists and contains available tools that the LLM can call.

### Key API Discovery #2: Tool Definition Structure

```typescript
// Line 20912-20927
export interface LanguageModelChatTool {
  name: string;              // Tool name
  description: string;       // Tool description
  inputSchema?: object;      // JSON Schema for tool input
}
```

### Key API Discovery #3: Tool Call Response Types

```typescript
// Line 20949-20967
export class LanguageModelToolCallPart {
  callId: string;    // Unique identifier for this tool call
  name: string;      // Name of tool to call
  input: object;     // Input parameters for the tool
}

// Line 20984-20995
export class LanguageModelToolResultPart {
  callId: string;    // Matches the tool call ID
  content: Array<...>; // Result content
}
```

### Key API Discovery #4: Tool Invocation API

```typescript
// Line 20844
export function invokeTool(
  name: string, 
  options: LanguageModelToolInvocationOptions<object>, 
  token?: CancellationToken
): Thenable<LanguageModelToolResult>;
```

### Key API Discovery #5: Tools Registry

```typescript
// Line 20816
export const tools: readonly LanguageModelToolInformation[];
```

**All registered tools are accessible via `vscode.lm.tools`**

---

## How Tool Calling Works (The Missing Loop)

### The Tool Calling Loop

When tools are available, the provider must implement this loop:

```
1. User sends message
   ↓
2. Call LLM with tools parameter
   ↓
3. LLM responds with either:
   a) Text response → Return to user (done)
   b) Tool call request → Continue to step 4
   ↓
4. Execute the tool via lm.invokeTool()
   ↓
5. Send tool result back to LLM
   ↓
6. LLM generates final response
   ↓
7. Return response to user
```

### Why I Thought Tools Weren't Supported

The `_options` parameter **DOES** contain tools, but:
- I didn't examine the full VS Code API initially
- I assumed the parameter was empty based on incomplete documentation
- **This was incorrect** - the tools ARE passed through `options.tools`

---

## Requirements for Tool Proxy Implementation

### FR-1: Receive Tool Definitions

**Requirement**: Extension must receive available tools from Antigravity

**Implementation**:
```typescript
async provideLanguageModelChatResponse(
  model: vscode.LanguageModelChatInformation,
  messages: readonly vscode.LanguageModelChatRequestMessage[],
  options: vscode.ProvideLanguageModelChatResponseOptions, // ← Contains tools!
  progress: vscode.Progress<vscode.LanguageModelResponsePart>,
  token: vscode.CancellationToken
): Promise<void> {
  const availableTools = options.tools; // ← Tools are here!
  // ...
}
```

**Evidence**: Line 20605 in vscode.d.ts

---

### FR-2: Convert Tools to Provider Format

**Requirement**: Convert VS Code tool definitions to provider-specific format

**Input** (VS Code format):
```typescript
{
  name: "browser_navigate",
  description: "Navigate browser to URL",
  inputSchema: {
    type: "object",
    properties: {
      url: { type: "string" }
    }
  }
}
```

**Output** (OpenAI format):
```json
{
  "type": "function",
  "function": {
    "name": "browser_navigate",
    "description": "Navigate browser to URL",
    "parameters": {
      "type": "object",
      "properties": {
        "url": { "type": "string" }
      }
    }
  }
}
```

**Implementation Location**: `extension/src/provider/toolMapper.ts` (new file)

---

### FR-3: Send Tools to Router/Provider

**Requirement**: Include tool definitions in API request to router

**Request Format**:
```json
{
  "model": "gpt-4",
  "provider": "openai",
  "messages": [...],
  "tools": [
    {
      "type": "function",
      "function": { ... }
    }
  ],
  "tool_choice": "auto",
  "stream": true
}
```

**Implementation**: Update `RouterChatRequest` interface in `routerClient.ts`

---

### FR-4: Handle Tool Call Responses

**Requirement**: Detect when provider wants to call a tool

**Provider Response** (OpenAI format):
```json
{
  "choices": [{
    "message": {
      "role": "assistant",
      "content": null,
      "tool_calls": [{
        "id": "call_abc123",
        "type": "function",
        "function": {
          "name": "browser_navigate",
          "arguments": "{\"url\":\"https://example.com\"}"
        }
      }]
    }
  }]
}
```

**Implementation**: Update response mapper to detect `tool_calls` field

---

### FR-5: Execute Tools via VS Code API

**Requirement**: Call the actual tool using `lm.invokeTool()`

```typescript
const toolResult = await vscode.lm.invokeTool(
  toolName,
  {
    input: toolInput,
    toolInvocationToken: undefined // Not in chat context
  },
  token
);
```

**Evidence**: Line 20844 in vscode.d.ts

---

### FR-6: Return Tool Results to Provider

**Requirement**: Send tool execution results back to provider

**Message Format**:
```typescript
// Assistant message with tool call
{
  role: "assistant",
  content: [
    new vscode.LanguageModelToolCallPart("call_abc123", "browser_navigate", { url: "https://example.com" })
  ]
}

// User message with tool result
{
  role: "user",
  content: [
    new vscode.LanguageModelToolResultPart("call_abc123", [
      new vscode.LanguageModelTextPart("Navigated to https://example.com")
    ])
  ]
}
```

---

### FR-7: Stream Tool Call Progress

**Requirement**: Show tool execution progress to user

```typescript
// Emit tool call to progress stream
progress.report(new vscode.LanguageModelToolCallPart(callId, toolName, input));

// Execute tool...

// Emit tool result
progress.report(new vscode.LanguageModelToolResultPart(callId, [result]));
```

---

### FR-8: Handle Multiple Tool Calls

**Requirement**: Support parallel tool calls in single response

**Implementation**:
- Provider may return multiple `tool_calls` in one response
- Execute all tools (can be parallel)
- Return all results in next message

---

### FR-9: Tool Mode Support

**Requirement**: Respect `toolMode` parameter

```typescript
enum LanguageModelChatToolMode {
  Auto = 1,      // LLM decides whether to use tools
  Required = 2   // LLM MUST call a tool
}
```

**Implementation**: Pass `tool_choice` parameter to provider:
- `Auto` → `"auto"`
- `Required` → `"required"` or `"any"`

---

## Architecture Design

### Component Diagram

```
┌─────────────────────────────────────────────┐
│           Antigravity Chat UI               │
│                                             │
│  User: "Open google.com in browser"         │
│  Tools: [@browser, @workspace, @terminal]   │
└──────────────┬──────────────────────────────┘
               │
               │ messages + options.tools
               ▼
┌─────────────────────────────────────────────┐
│   McpRouterLanguageModelProvider            │
│   (extension/src/provider/lmProvider.ts)    │
│                                             │
│  1. Receive tools from options.tools        │
│  2. Map to provider format                  │
│  3. Send to router with tool definitions    │
│  4. Detect tool_call in response            │
│  5. Execute tool via lm.invokeTool()        │
│  6. Send tool result back to provider       │
│  7. Stream final response                   │
└──────┬──────────────────────┬───────────────┘
       │                      │
       │ Tool definitions     │ Tool execution
       ▼                      ▼
┌──────────────┐    ┌─────────────────────┐
│ Router API   │    │ vscode.lm.invokeTool│
│ (HTTP)       │    │                     │
│              │    │ Executes:           │
│ Routes to    │    │ - @browser tools    │
│ provider     │    │ - @workspace tools  │
│ with tools   │    │ - @terminal tools   │
└──────────────┘    └─────────────────────┘
```

### New Files Required

1. **`extension/src/provider/toolMapper.ts`**
   - Maps VS Code tools → provider format
   - Maps provider tool_calls → VS Code format

2. **`extension/src/provider/toolExecutor.ts`**
   - Executes tools via `lm.invokeTool()`
   - Handles tool result formatting
   - Manages tool execution loop

3. **`extension/src/provider/toolLoop.ts`**
   - Implements the tool calling loop
   - Manages conversation history with tool calls/results
   - Handles parallel tool calls

### Modified Files

1. **`extension/src/provider/lmProvider.ts`**
   - Add tool handling to `provideLanguageModelChatResponse()`
   - Implement tool calling loop

2. **`extension/src/provider/requestMapper.ts`**
   - Add tool definitions to router requests

3. **`extension/src/provider/responseMapper.ts`**
   - Detect and handle tool_call responses
   - Stream tool call progress

4. **`extension/src/client/routerClient.ts`**
   - Update `RouterChatRequest` to include tools
   - Handle tool_call responses

5. **`src/server/extensionApiServer.ts`**
   - Pass tool definitions to providers
   - Support tool_choice parameter

---

## Implementation Priority

### Phase 1: Basic Tool Support (2-3 days)

**Goal**: Single tool call works end-to-end

1. ✅ Receive tools from `options.tools`
2. ✅ Map tools to OpenAI/GLM format
3. ✅ Send tools to router
4. ✅ Detect tool_call in response
5. ✅ Execute ONE tool via `lm.invokeTool()`
6. ✅ Send result back to provider
7. ✅ Stream final response

**Success Criteria**:
- Can call `@browser.navigate` from custom model
- Browser actually navigates
- Response streamed to user

---

### Phase 2: Advanced Tool Features (2-3 days)

**Goal**: Multiple tools, parallel execution, error handling

1. Support multiple tool calls in one response
2. Execute tools in parallel when possible
3. Handle tool execution errors gracefully
4. Respect `toolMode` (auto vs required)
5. Show tool execution progress in UI
6. Handle tool confirmation dialogs

**Success Criteria**:
- Can call multiple tools in one turn
- Parallel tools execute simultaneously
- Errors are handled and reported

---

### Phase 3: Optimization (1-2 days)

**Goal**: Performance and reliability

1. Cache tool definitions (don't remap every request)
2. Optimize tool result size (truncate large outputs)
3. Add retry logic for failed tool calls
4. Implement timeout for tool execution
5. Add metrics for tool usage

**Success Criteria**:
- Tool calls complete in < 5 seconds
- Large tool results are truncated safely
- Failed tools retry automatically

---

## Testing Strategy

### Unit Tests

1. **Tool Mapping Tests**
   - VS Code → OpenAI format
   - VS Code → GLM format
   - Edge cases (missing schema, etc.)

2. **Tool Response Detection Tests**
   - Detect tool_call in streaming response
   - Detect tool_call in non-streaming response
   - Handle mixed text + tool_call responses

3. **Tool Execution Tests**
   - Mock `lm.invokeTool()`
   - Test error handling
   - Test parallel execution

### Integration Tests

1. **End-to-End Tool Call Test**
   - Register mock tool
   - Send request with tools
   - Verify tool is called
   - Verify result is returned

2. **Multi-Turn Tool Test**
   - Tool call in turn 1
   - Provider uses result in turn 2
   - Final response includes tool context

### Manual Tests

1. **Browser Control Test**
   ```
   Model: "Open google.com in browser"
   Expected: Browser navigates to google.com ✅
   ```

2. **File Operation Test**
   ```
   Model: "Read the contents of package.json"
   Expected: File is read and content is returned ✅
   ```

3. **Terminal Command Test**
   ```
   Model: "List files in current directory"
   Expected: Command executes and output is returned ✅
   ```

---

## Risks and Mitigations

### Risk 1: Tool Execution Permissions

**Risk**: Tools may require user confirmation

**Mitigation**: 
- Show confirmation UI via `toolInvocationToken`
- Handle user rejection gracefully
- Inform model when tool is denied

### Risk 2: Large Tool Results

**Risk**: Tool returns too much data (e.g., large file)

**Mitigation**:
- Truncate results to reasonable size
- Inform model about truncation
- Allow model to request more data

### Risk 3: Tool Execution Failures

**Risk**: Tool fails during execution

**Mitigation**:
- Catch errors and format as tool result
- Inform model about failure
- Allow model to retry or use alternative

### Risk 4: Infinite Tool Loop

**Risk**: Model keeps calling tools without finishing

**Mitigation**:
- Maximum tool calls per request (e.g., 10)
- Timeout for entire tool loop
- Detect repetitive tool calls

---

## Success Metrics

### Quantitative Metrics

- ✅ Tool calls execute in < 5 seconds (p95)
- ✅ Tool success rate > 95%
- ✅ No infinite loops (max 10 calls per request)
- ✅ Support at least 5 concurrent tool calls

### Qualitative Metrics

- ✅ Users can control browser with custom models
- ✅ Users can read/write files with custom models
- ✅ Users can execute terminal commands with custom models
- ✅ Tool execution is visible in chat UI
- ✅ Errors are clearly communicated

---

## Conclusion

**The tool proxy feature IS feasible and supported by the VS Code API.**

The key insight I missed initially: `options.tools` DOES contain the available tools. We just need to:

1. ✅ Pass tools to the provider (router)
2. ✅ Detect when provider wants to call a tool
3. ✅ Execute the tool via `lm.invokeTool()`
4. ✅ Send result back to provider
5. ✅ Stream final response

**Estimated Implementation Time**: 5-8 days total
- Phase 1: 2-3 days (basic support)
- Phase 2: 2-3 days (advanced features)
- Phase 3: 1-2 days (optimization)

**Recommendation**: Start with Phase 1 to validate the approach, then iterate.

---

## Appendix: VS Code API References

All evidence from: `C:\Users\user\AppData\Local\Programs\Antigravity\resources\app\out\vscode-dts\vscode.d.ts`

| Feature | Line Number | Description |
|---------|-------------|-------------|
| `ProvideLanguageModelChatResponseOptions.tools` | 20605 | Available tools for LLM |
| `LanguageModelChatTool` | 20912-20927 | Tool definition interface |
| `LanguageModelChatToolMode` | 20932-20943 | Auto vs Required mode |
| `LanguageModelToolCallPart` | 20949-20967 | Tool call response part |
| `LanguageModelToolResultPart` | 20984-20995 | Tool result part |
| `lm.invokeTool()` | 20844 | Execute a tool |
| `lm.tools` | 20816 | All registered tools |
| `LanguageModelToolInvocationOptions` | 21108-21134 | Tool invocation options |
| `LanguageModelToolResult` | 21035-21048 | Tool execution result |
