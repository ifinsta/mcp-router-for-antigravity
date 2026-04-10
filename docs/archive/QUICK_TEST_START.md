# 🚀 Quick Start: Testing Tool Proxy

## VSIX Package Ready!

📦 **File**: `antigravity-custom-models-0.1.0.vsix`  
📍 **Location**: `c:\Users\user\CascadeProjects\mcp-router-for-antigravity\extension\`  
📊 **Size**: 77.46 KB

---

## 3-Step Installation

### 1️⃣ Start MCP Router
```bash
cd c:\Users\user\CascadeProjects\mcp-router-for-antigravity
npm run dev
```
✅ Verify: http://localhost:3000/health → `{"status":"ok"}`

### 2️⃣ Install VSIX in Antigravity
1. Open Antigravity
2. `Ctrl+Shift+X` → Extensions
3. Click `...` → "Install from VSIX..."
4. Select the `.vsix` file
5. Click "Reload"

### 3️⃣ Test It!
1. Open Antigravity Chat
2. Select custom model (e.g., "openai:gpt-4")
3. Type: "What is TypeScript?"
4. Send ✅

---

## Quick Test Checklist

- [ ] Extension loads (no errors in Output panel)
- [ ] Models appear in selector
- [ ] Simple chat works
- [ ] Tool calling works (try: "Read package.json")
- [ ] No crashes or hangs

---

## Where to See Logs

**Output Panel**: `Ctrl+Shift+U` → "Antigravity Custom Models"

**Look for**:
```
[lm-provider] Tools available: X tools
[tool-executor] Executing tool: file_read
[tool-executor] Tool execution successful
```

---

## Expected Behavior

### Without Tools (Current State)
```
User: "What is TypeScript?"
→ Model responds normally
```

### With Tools (When Antigravity Provides Them)
```
User: "Read package.json"
→ Model requests tool call
→ Tool executes
→ Model responds with file contents
```

---

## Full Testing Guide

📖 See: `docs/SPRINT1_TESTING_GUIDE.md` for detailed test plan

---

## Issues?

Check these first:
1. MCP Router running? → http://localhost:3000/health
2. API keys configured? → `Ctrl+Shift+P` → "Configure API Keys"
3. Base URL correct? → Settings → `mcpRouter.baseUrl`

---

**Ready to test! Good luck!** 🎉
