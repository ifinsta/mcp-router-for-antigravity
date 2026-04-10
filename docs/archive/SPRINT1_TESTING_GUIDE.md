# Sprint 1: Integration Testing Guide

## 📦 VSIX Package Built Successfully!

**Package Location**: 
```
c:\Users\user\CascadeProjects\mcp-router-for-antigravity\extension\antigravity-custom-models-0.1.0.vsix
```

**Package Size**: 77.46 KB  
**Files Included**: 73 files  
**Version**: 0.1.0

---

## 🚀 Installation Steps

### Step 1: Ensure MCP Router is Running

Before testing, make sure the MCP Router backend is running:

```bash
cd c:\Users\user\CascadeProjects\mcp-router-for-antigravity
npm run dev
```

Verify it's running:
- Open: http://localhost:3000/health
- Should see: `{"status":"ok","healthy":true}`

---

### Step 2: Install VSIX in Antigravity

1. **Open Antigravity** (VS Code-based IDE)

2. **Open Extensions View**
   - Press `Ctrl+Shift+X`
   - Or click Extensions icon in Activity Bar

3. **Install from VSIX**
   - Click `...` (More Actions) in Extensions view
   - Select "Install from VSIX..."
   - Navigate to: `c:\Users\user\CascadeProjects\mcp-router-for-antigravity\extension\antigravity-custom-models-0.1.0.vsix`
   - Click "Install"

4. **Reload Antigravity**
   - Click "Reload" when prompted
   - Or press `Ctrl+Shift+P` → "Reload Window"

---

### Step 3: Configure Extension

1. **Open Settings**
   - Press `Ctrl+,`
   - Or `Ctrl+Shift+P` → "Preferences: Open Settings"

2. **Search for "mcpRouter"**

3. **Verify Settings**:
   - `Mcp Router: Base Url` → `http://localhost:3000` (default)
   - `Mcp Router: Timeout` → `60000` (default)
   - `Mcp Router: Show Only Healthy Models` → `true` (default)

4. **Configure API Keys** (if not already done)
   - Press `Ctrl+Shift+P`
   - Type: "MCP Router: Configure API Keys"
   - Add your provider API keys (OpenAI, GLM, etc.)

---

## 🧪 Test Plan

### Test 1: Extension Loads Successfully

**Steps**:
1. Open Antigravity with extension installed
2. Open Output panel: `Ctrl+Shift+U`
3. Select "Antigravity Custom Models" from dropdown

**Expected**:
```
[mcp-router-extension] Extension activated
[lm-provider] Extension activated successfully
[router-client] Router client initialized
[model-catalog] Model catalog initialized
```

**Pass Criteria**: ✅ No errors in output log

---

### Test 2: Models Appear in Selector

**Steps**:
1. Open Antigravity Chat (Antigravity panel)
2. Click model selector dropdown
3. Look for custom models

**Expected**:
- Models from your configured providers appear
- Format: "provider:model-name" (e.g., "openai:gpt-4", "glm:glm-4")
- Models show healthy status

**Pass Criteria**: ✅ At least one custom model visible

---

### Test 3: Simple Chat (No Tools)

**Steps**:
1. Select a custom model (e.g., "openai:gpt-4")
2. Type: "What is TypeScript in 2 sentences?"
3. Send message

**Expected**:
```
[Logs]
[lm-provider] Processing chat request for model: openai:gpt-4
[lm-provider] Simple chat without tools (or tools not available)
[request-mapper] Mapped 1 messages for model openai:gpt-4
[response-mapper] Streamed X chunks successfully
[lm-provider] Chat request completed successfully
```

**Response**: Model answers the question

**Pass Criteria**: ✅ Normal chat response received

---

### Test 4: Tool Calling - File Read

**⚠️ IMPORTANT**: This test requires Antigravity to provide tools to the extension.

**Steps**:
1. Select a custom model
2. Open a workspace with files
3. Type: "Read the file package.json and tell me what dependencies it has"
4. Send message

**Expected Flow**:
```
[Logs]
[lm-provider] Processing chat request for model: openai:gpt-4
[lm-provider] Tools available: 5 tools, mode: Auto
[request-mapper] Including 5 tools in request for provider openai
[tool-mapper] Converting tools to OpenAI format

[Tool Calling Loop - Iteration 1]
[lm-provider] Tool calling iteration 1/10
[response-mapper] Detected tool call: file_read (call_abc123)
[tool-mapper] Converted OpenAI tool call: file_read (call_abc123)
[tool-executor] Executing tool: file_read (call_abc123)
[tool-executor] Tool execution successful: file_read (call_abc123)
[tool-executor] Tools executed: 1/1 succeeded (file_read)

[Tool Calling Loop - Iteration 2]
[lm-provider] Tool calling iteration 2/10
[response-mapper] No tool calls detected
[lm-provider] No tool calls detected after iteration 2, ending loop
[lm-provider] Chat request completed successfully
```

**Response**: Model lists the dependencies from package.json

**Pass Criteria**: 
- ✅ Tool call detected
- ✅ Tool executed successfully
- ✅ Result returned to model
- ✅ Model provides correct answer

---

### Test 5: Multiple Tool Calls

**Steps**:
1. Select a custom model
2. Type: "Read both package.json and tsconfig.json, then compare their structure"
3. Send message

**Expected**:
```
[Logs]
[lm-provider] Tool calling iteration 1/10
[response-mapper] Detected tool call: file_read (call_1)
[response-mapper] Detected tool call: file_read (call_2)
[tool-executor] Executing 2 tool calls
[tool-executor] Tool execution successful: file_read (call_1)
[tool-executor] Tool execution successful: file_read (call_2)
[tool-executor] Tools executed: 2/2 succeeded (file_read, file_read)
```

**Response**: Model compares both files

**Pass Criteria**: 
- ✅ Multiple tool calls detected
- ✅ Both tools execute
- ✅ Results returned correctly

---

### Test 6: Tool Error Handling

**Steps**:
1. Select a custom model
2. Type: "Read the file nonexistent-file.txt"
3. Send message

**Expected**:
```
[Logs]
[tool-executor] Executing tool: file_read (call_xyz)
[tool-executor] Tool execution failed: file_read (call_xyz): File not found
[tool-executor] Tools executed: 0/1 succeeded (file_read)
```

**Response**: Model informs user the file doesn't exist

**Pass Criteria**: 
- ✅ Error caught gracefully
- ✅ Model informed of failure
- ✅ No crash or hang

---

### Test 7: Tool Calling Loop Protection

**Steps**:
1. Select a custom model
2. Try to trigger excessive tool calling (model keeps calling tools)

**Expected**:
```
[Logs]
[lm-provider] Tool calling iteration 8/10
[lm-provider] Tool calling iteration 9/10
[lm-provider] Tool calling iteration 10/10
[lm-provider] Reached maximum tool calling iterations (10)
```

**Response**: User sees warning message

**Pass Criteria**: 
- ✅ Loop stops at 10 iterations
- ✅ Warning shown to user

---

### Test 8: Different Providers

**Test with each provider**:

| Provider | Model | Test | Status |
|----------|-------|------|--------|
| OpenAI | gpt-4 | Tool calling | ⏳ |
| OpenAI | gpt-3.5-turbo | Tool calling | ⏳ |
| GLM | glm-4 | Tool calling | ⏳ |
| Claude | claude-3-sonnet | Tool calling | ⏳ |

**For each provider**:
1. Select model
2. Test simple chat
3. Test tool calling
4. Verify logs show correct provider format

---

## 📊 Test Results Template

Copy this template and fill in results:

```markdown
# Test Results - Sprint 1

## Environment
- **Antigravity Version**: 
- **Extension Version**: 0.1.0
- **MCP Router Version**: 
- **Date**: 
- **OS**: Windows 22H2

## Test Results

### Test 1: Extension Loads
- **Status**: ✅ PASS / ❌ FAIL
- **Notes**: 

### Test 2: Models Appear
- **Status**: ✅ PASS / ❌ FAIL
- **Models Found**: 
- **Notes**: 

### Test 3: Simple Chat
- **Status**: ✅ PASS / ❌ FAIL
- **Model Used**: 
- **Response Time**: 
- **Notes**: 

### Test 4: Tool Calling - File Read
- **Status**: ✅ PASS / ❌ FAIL
- **Tool Calls Detected**: 
- **Execution Time**: 
- **Notes**: 

### Test 5: Multiple Tool Calls
- **Status**: ✅ PASS / ❌ FAIL
- **Tools Called**: 
- **Parallel Execution**: 
- **Notes**: 

### Test 6: Tool Error Handling
- **Status**: ✅ PASS / ❌ FAIL
- **Error Message**: 
- **Recovery**: 
- **Notes**: 

### Test 7: Loop Protection
- **Status**: ✅ PASS / ❌ FAIL / ⚠️ NOT TESTED
- **Iterations**: 
- **Notes**: 

### Test 8: Multiple Providers
- **OpenAI**: ✅ PASS / ❌ FAIL
- **GLM**: ✅ PASS / ❌ FAIL
- **Claude**: ✅ PASS / ❌ FAIL / ⚠️ NOT TESTED
- **Notes**: 

## Issues Found

1. **Issue**: 
   - **Severity**: High/Medium/Low
   - **Steps to Reproduce**: 
   - **Expected**: 
   - **Actual**: 

## Performance Metrics

| Metric | Value |
|--------|-------|
| Extension Load Time | |
| Model Catalog Load | |
| Simple Chat Latency | |
| Tool Call Latency | |
| Multi-tool Latency | |

## Overall Assessment

**Sprint 1 Status**: ✅ PASS / ❌ FAIL

**Ready for Sprint 2**: Yes/No

**Blockers**: 
```

---

## 🔍 Debugging Tips

### Enable Verbose Logging

In Antigravity settings:
```json
{
  "mcpRouter.logLevel": "debug"
}
```

### Check Logs

**Output Panel**:
- `Ctrl+Shift+U` → Select "Antigravity Custom Models"

**Look for**:
- `[lm-provider]` - Main request handling
- `[tool-mapper]` - Tool format conversion
- `[tool-executor]` - Tool execution
- `[request-mapper]` - Request formatting
- `[response-mapper]` - Response parsing

### Common Issues

**Issue**: No models appear
**Fix**: 
1. Check MCP Router is running
2. Check API keys configured
3. Check base URL in settings

**Issue**: Tools not available
**Fix**:
1. Verify Antigravity version supports tools (≥1.107.0)
2. Check workspace has files
3. Check tool definitions in logs

**Issue**: Tool execution fails
**Fix**:
1. Check tool exists: `vscode.lm.tools`
2. Check tool input matches schema
3. Check file permissions

**Issue**: Tool calls not detected
**Fix**:
1. Check response format in logs
2. Verify provider (OpenAI vs Claude)
3. Check hasToolCalls() logic

---

## 📸 Screenshot Checklist

Take screenshots of:

1. ✅ Extension installed in Antigravity
2. ✅ Models in selector dropdown
3. ✅ Simple chat response
4. ✅ Tool calling in logs
5. ✅ Tool execution success
6. ✅ Error handling (if triggered)

---

## 🎯 Success Criteria

Sprint 1 is considered **SUCCESSFUL** if:

- ✅ Extension installs without errors
- ✅ Models appear in selector
- ✅ Simple chat works
- ✅ At least ONE tool call succeeds end-to-end
- ✅ No crashes or hangs
- ✅ Error handling works gracefully

**Minimum Viable**: Tests 1-4 pass

**Full Success**: Tests 1-8 pass

---

## 🚦 Go/No-Go Decision

After testing, decide:

### ✅ GO (Continue to Sprint 2)
- Minimum viable tests pass
- Core tool calling works
- No critical bugs

### ⚠️ CONDITIONAL GO
- Core features work
- Minor bugs found (documented)
- Fix bugs before Sprint 2

### ❌ NO-GO (Fix Required)
- Core features broken
- Tool calling doesn't work
- Critical bugs found

---

## 📞 Next Steps After Testing

### If PASS:
1. Document test results
2. Move to Sprint 2
3. Start long-horizon features

### If FAIL:
1. Document issues
2. Create bug fixes
3. Re-test
4. Then proceed to Sprint 2

---

## 🎬 Ready to Test!

**VSIX Location**: 
```
c:\Users\user\CascadeProjects\mcp-router-for-antigravity\extension\antigravity-custom-models-0.1.0.vsix
```

**Testing Time Estimate**: 30-60 minutes

**Good luck! Report back with results!** 🚀
