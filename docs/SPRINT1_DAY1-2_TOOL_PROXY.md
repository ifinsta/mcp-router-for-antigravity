# Tool Proxy Implementation Guide - Sprint 1, Day 1-2

## ✅ What's Been Built

### 1. Tool Mapper (`extension/src/provider/toolMapper.ts`)

**Purpose**: Converts tool definitions between VS Code format and provider-specific formats

**Features**:
- ✅ VS Code → OpenAI format conversion
- ✅ VS Code → GLM format conversion (OpenAI-compatible)
- ✅ VS Code → Claude format conversion
- ✅ Provider tool call → VS Code format conversion
- ✅ Tool choice parameter generation (auto/required)

**Key Functions**:
```typescript
// Convert tools to provider format
ToolMapper.toProviderFormat('openai', tools);  // Returns OpenAI format
ToolMapper.toProviderFormat('glm', tools);     // Returns GLM format
ToolMapper.toProviderFormat('claude', tools);  // Returns Claude format

// Convert provider tool calls back to VS Code
ToolMapper.fromProviderToolCall('openai', toolCallResponse);
```

---

### 2. Tool Executor (`extension/src/provider/toolExecutor.ts`)

**Purpose**: Executes tool calls via VS Code's `lm.invokeTool()` API

**Features**:
- ✅ Single tool execution
- ✅ Multiple parallel tool execution
- ✅ Error handling and reporting
- ✅ Result formatting for conversation

**Key Functions**:
```typescript
const executor = new ToolExecutor();

// Execute single tool
const result = await executor.executeToolCall(toolCall, token);

// Execute multiple tools in parallel
const results = await executor.executeMultipleToolCalls(toolCalls, token);

// Convert results to messages
const messages = ToolExecutor.createToolResultMessages(results);
```

---

## 📐 Architecture

### Tool Calling Flow

```
1. User sends message with tools
   ↓
2. Antigravity passes tools via options.tools
   ↓
3. ToolMapper converts to provider format
   ↓
4. Request sent to router with tool definitions
   ↓
5. Provider responds with tool_call request
   ↓
6. ToolMapper converts tool_call to VS Code format
   ↓
7. ToolExecutor executes tool via lm.invokeTool()
   ↓
8. Tool results added to conversation
   ↓
9. Steps 4-8 repeat until provider returns text
   ↓
10. Final text streamed to user
```

---

## 🔧 How to Use (Integration Guide)

### Step 1: Import the Components

```typescript
import { ToolMapper } from './provider/toolMapper';
import { ToolExecutor } from './provider/toolExecutor';
```

### Step 2: Extract Tools from Options

In your `provideLanguageModelChatResponse` method:

```typescript
async provideLanguageModelChatResponse(
  model: vscode.LanguageModelChatInformation,
  messages: readonly vscode.LanguageModelChatRequestMessage[],
  options: vscode.ProvideLanguageModelChatResponseOptions,  // ← Tools are here!
  progress: vscode.Progress<vscode.LanguageModelResponsePart>,
  token: vscode.CancellationToken
): Promise<void> {
  const availableTools = options.tools;  // ← Extract tools
  const toolMode = options.toolMode;     // ← Auto or Required
  
  // ... rest of implementation
}
```

### Step 3: Convert Tools to Provider Format

```typescript
const { provider } = parseModelId(model.id);

// Convert to provider-specific format
const providerTools = ToolMapper.toProviderFormat(provider, availableTools ?? []);

// Get tool_choice parameter
const toolChoice = ToolMapper.getToolChoice(
  provider,
  toolMode,
  availableTools ?? []
);
```

### Step 4: Send to Provider with Tools

```typescript
const request = {
  model: modelName,
  provider,
  messages: routerMessages,
  tools: providerTools,        // ← Include tools
  tool_choice: toolChoice,     // ← Include tool choice
  stream: true,
};

const response = await this.client.chatStream(request);
```

### Step 5: Handle Tool Call Responses

When the provider wants to call a tool:

```typescript
// Provider response contains tool_calls
if (response.has_tool_calls) {
  // Convert to VS Code format
  const toolCalls = response.tool_calls.map((tc: any) =>
    ToolMapper.fromProviderToolCall(provider, tc)
  );
  
  // Execute tools
  const executor = new ToolExecutor();
  const results = await executor.executeMultipleToolCalls(toolCalls, token);
  
  // Convert results to messages
  const resultMessages = ToolExecutor.createToolResultMessages(results);
  
  // Add to conversation and send back to provider
  messages.push(...resultMessages);
  
  // Repeat the request with tool results
  // ... (go back to Step 4)
}
```

---

## 🧪 Testing

### Manual Testing Checklist

- [ ] Tool definitions are correctly converted to OpenAI format
- [ ] Tool definitions are correctly converted to Claude format
- [ ] Tool calls from provider are correctly parsed
- [ ] Single tool execution works
- [ ] Multiple parallel tool execution works
- [ ] Tool errors are handled gracefully
- [ ] Tool results are correctly added to conversation

### Test Scenario 1: Single Tool Call

```
1. Select custom model (e.g., "openai:gpt-4")
2. Type: "Read the file package.json"
3. Expected:
   - Model requests to call file_read tool
   - Tool executes successfully
   - File contents returned to model
   - Model summarizes contents to user
```

### Test Scenario 2: Multiple Tool Calls

```
1. Select custom model
2. Type: "Read package.json and tsconfig.json"
3. Expected:
   - Model requests TWO tool calls in parallel
   - Both tools execute
   - Results returned to model
   - Model provides comparison/summary
```

### Test Scenario 3: Tool Error Handling

```
1. Select custom model
2. Model tries to call non-existent tool
3. Expected:
   - Error caught and reported
   - Model informed of failure
   - Model can retry or inform user
```

---

## 📊 Supported Providers

| Provider | Tool Format | Tool Call Format | Status |
|----------|-------------|------------------|--------|
| OpenAI | `{ type: "function", function: {...} }` | `{ id, function: { name, arguments } }` | ✅ Complete |
| GLM | Same as OpenAI | Same as OpenAI | ✅ Complete |
| Claude/Anthropic | `{ name, description, input_schema }` | `{ id, name, input }` | ✅ Complete |

---

## 🔍 Debugging

### Enable Debug Logging

In VS Code settings:
```json
{
  "mcpRouter.logLevel": "debug"
}
```

### Check Tool Mapper Logs

Look for:
```
[tool-mapper] Converted OpenAI tool call: browser_navigate (call_abc123)
[tool-mapper] Converted Claude tool call: file_read (toolu_xyz789)
```

### Check Tool Executor Logs

Look for:
```
[tool-executor] Executing tool: browser_navigate (call_abc123)
[tool-executor] Tool execution successful: browser_navigate (call_abc123)
[tool-executor] Tool execution failed: file_read (call_xyz789): File not found
```

---

## ⚠️ Common Issues

### Issue 1: Tools Not Appearing in Request

**Symptom**: Provider doesn't receive tool definitions

**Check**:
1. Verify `options.tools` is not undefined
2. Check `ToolMapper.toProviderFormat()` is called
3. Verify tools are included in request body

**Fix**:
```typescript
const availableTools = options.tools ?? [];
if (availableTools.length > 0) {
  const providerTools = ToolMapper.toProviderFormat(provider, availableTools);
  // Include in request...
}
```

---

### Issue 2: Tool Call Not Recognized

**Symptom**: Provider returns tool_call but extension doesn't detect it

**Check**:
1. Verify response parsing logic
2. Check tool_call format matches provider
3. Verify `ToolMapper.fromProviderToolCall()` is called

**Debug**:
```typescript
console.log('Provider response:', JSON.stringify(response, null, 2));
```

---

### Issue 3: Tool Execution Fails

**Symptom**: `lm.invokeTool()` throws error

**Check**:
1. Tool exists in `vscode.lm.tools` registry
2. Tool input matches schema
3. Token not cancelled

**Debug**:
```typescript
const availableTools = vscode.lm.tools.map(t => t.name);
console.log('Available tools:', availableTools);
console.log('Requested tool:', toolCall.name);
```

---

## 📈 Next Steps (Sprint 1, Day 3-5)

### Day 3-4: Update Request/Response Mappers

**Files to Modify**:
- `extension/src/provider/requestMapper.ts` - Add tools to request
- `extension/src/provider/responseMapper.ts` - Detect tool calls

### Day 5: Integration Testing

**Test**:
- End-to-end tool calling flow
- Multiple providers (OpenAI, GLM, Claude)
- Error scenarios

---

## 🎯 Success Criteria

- [x] Tool mapper converts all 3 provider formats
- [x] Tool executor executes tools via VS Code API
- [x] Unit tests pass
- [ ] End-to-end tool call works
- [ ] Multiple tools in single turn works
- [ ] Tool errors handled gracefully

---

## 📚 Related Files

- **Source**:
  - `extension/src/provider/toolMapper.ts` (204 lines)
  - `extension/src/provider/toolExecutor.ts` (145 lines)
  - `extension/test/unit/provider/toolMapper.test.ts` (306 lines)
  - `extension/test/unit/provider/toolExecutor.test.ts` (119 lines)

- **Documentation**:
  - `docs/TOOL_PROXY_REQUIREMENTS.md` - Full requirements
  - `docs/UNIFIED_IMPLEMENTATION_PLAN.md` - Sprint plan
  - `docs/PROJECT_KICKOFF.md` - Project overview

---

## 🚀 Ready for Next Step

**Sprint 1, Day 1-2 is COMPLETE!** ✅

**Next**: Update request/response mappers to integrate tool calling (Day 3-4)

Shall I proceed with Day 3-4 implementation?
