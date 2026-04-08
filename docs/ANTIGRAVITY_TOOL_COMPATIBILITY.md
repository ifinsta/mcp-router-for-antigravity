# Antigravity Tool Compatibility Investigation

## Executive Summary

**⚠️ CRITICAL FINDING**: Models registered via the Language Model Provider API **WILL NOT** automatically work with Antigravity's built-in tools (browser control, file operations, terminal, etc.).

**Why**: Antigravity's tools are tied to its **own** LLM integration, not to third-party Language Model providers. Custom models only receive chat messages, not tool execution requests.

---

## Detailed Analysis

### How Antigravity Tools Work

Antigravity (built on VS Code) has two separate systems:

#### 1. **Built-in Copilot Chat** (Has Tools ✅)
- Uses GitHub Copilot's models (GPT-4, Claude, etc.)
- Has access to Antigravity's MCP tools:
  - `@workspace` - File operations
  - `@terminal` - Terminal commands
  - `@browser` - Browser control
  - `@vscode` - Editor operations
- These tools are executed by **Antigravity itself**, not the LLM

#### 2. **Language Model Provider API** (No Tools ❌)
- Third-party models registered via `vscode.lm.registerLanguageModelChatProvider()`
- Only receives **text messages**
- Does NOT receive tool definitions
- Does NOT receive tool call requests
- Cannot trigger Antigravity's built-in tools

### The Architecture Gap

```
┌─────────────────────────────────────────────┐
│           Antigravity / VS Code             │
│                                             │
│  ┌──────────────────┐  ┌─────────────────┐ │
│  │  Copilot Chat    │  │  LM Provider    │ │
│  │  (Has Tools)     │  │  (No Tools)     │ │
│  │                  │  │                 │ │
│  │ • GPT-4          │  │ • Your Models   │ │
│  │ • Claude         │  │ • OpenAI        │ │
│  │ • Gemini         │  │ • GLM           │ │
│  │                  │  │                 │ │
│  │ ✅ Can use tools │  │ ❌ Text only    │ │
│  └──────────────────┘  └─────────────────┘ │
└─────────────────────────────────────────────┘
```

### What This Means for Your Custom Models

#### ❌ What Won't Work

1. **Browser Control** (`@browser`)
   - Your models cannot control browsers
   - Cannot navigate, click, or extract data
   - Antigravity won't send browser tool definitions to your provider

2. **File Operations** (`@workspace`)
   - Cannot read/write files
   - Cannot search codebase
   - Cannot access workspace

3. **Terminal Commands** (`@terminal`)
   - Cannot execute commands
   - Cannot run scripts
   - Cannot check processes

4. **Editor Operations** (`@vscode`)
   - Cannot open files
   - Cannot make edits
   - Cannot access selections

#### ✅ What Will Work

1. **Pure Chat** ✅
   - Answer questions
   - Write code snippets (as text)
   - Explain concepts
   - Translate languages
   - Summarize text

2. **Code Generation** ✅
   - Generate code (user must copy-paste)
   - Suggest improvements
   - Review code (if provided in context)

3. **Text Processing** ✅
   - Format text
   - Transform data
   - Analyze content

### The `_options` Parameter

Looking at the VS Code API:

```typescript
provideLanguageModelChatResponse(
  model: vscode.LanguageModelChatInformation,
  messages: readonly vscode.LanguageModelChatRequestMessage[],
  _options: vscode.ProvideLanguageModelChatResponseOptions,  // ← This might have tools?
  progress: vscode.Progress<vscode.LanguageModelResponsePart>,
  token: vscode.CancellationToken
): Promise<void>
```

**Investigation Result**: The `_options` parameter in current VS Code versions (1.107+) does **NOT** include tool definitions for third-party providers. It only contains:
- `justification` (for certain model types)
- Internal flags

Tools are only passed to **built-in** providers (Copilot, etc.).

---

## Workarounds and Solutions

### Solution 1: **MCP Router Tool Proxy** (RECOMMENDED ✅)

**How it works**: Your custom models can still use tools, but through the MCP Router, not through Antigravity's native tool system.

```
User: "Check the weather using browser"
     ↓
Antigravity Chat (with custom model selected)
     ↓
Extension → Router (via HTTP)
     ↓
Router sees request, recognizes it needs browser access
     ↓
Router uses its OWN MCP client to call browser tools
     ↓
Router returns result to model
     ↓
Model generates response
     ↓
Back to user
```

**Implementation**:
1. Router maintains its own MCP client connections
2. Router exposes tools via its API
3. Extension can request tool execution through router
4. Router executes tools and returns results

**Pros**:
- ✅ Full tool access
- ✅ Centralized tool management
- ✅ Works with any provider

**Cons**:
- ⚠️ Requires router enhancement
- ⚠️ Not "native" Antigravity tools
- ⚠️ Additional complexity

### Solution 2: **Hybrid Model Selection** (CURRENT STATE)

**How it works**:
- Use Copilot models (GPT-4, Claude) when you need tools
- Use your custom models when you only need chat

**Pros**:
- ✅ Simple
- ✅ No code changes needed
- ✅ Tools work with Copilot

**Cons**:
- ❌ Can't use custom models with tools
- ❌ Requires manual switching

### Solution 3: **MCP Server as Tool Backend** (FUTURE)

**How it works**:
- Register your own MCP server with Antigravity
- Your MCP server provides tools
- Custom models call your MCP tools via the router

```
Antigravity → Your MCP Server → Router → Provider
                  ↑
            Tool Execution
```

**Pros**:
- ✅ Proper MCP tool integration
- ✅ Standardized interface

**Cons**:
- ❌ Complex architecture
- ❌ Requires Antigravity MCP configuration
- ❌ Not yet implemented

---

## Current Implementation Status

### What We've Built

| Feature | Status | Notes |
|---------|--------|-------|
| Model registration | ✅ Complete | Models appear in selector |
| Chat functionality | ✅ Complete | Text-only works |
| Streaming | ✅ Complete | Real-time responses |
| API key management | ✅ Complete | Secure UI for keys |
| **Tool calling** | ❌ **Not supported** | VS Code API limitation |
| **Browser control** | ❌ **Not supported** | Requires Antigravity integration |
| **File operations** | ❌ **Not supported** | Requires Antigravity integration |
| **Terminal access** | ❌ **Not supported** | Requires Antigravity integration |

### What Antigravity's Native Integration Provides

When Antigravity uses its built-in MCP servers:

```
Antigravity Chat
  ↓
Antigravity MCP Client
  ↓
Your MCP Router (stdio)
  ↓
Tools: llm.chat, llm.list_models, router.health
```

This gives you:
- ✅ LLM access via router
- ✅ Resilience (retry, fallback, circuit breakers)
- ✅ Provider abstraction

But tools like `@browser`, `@workspace` are **Antigravity's own tools**, not from your MCP server.

---

## Recommendation

### For Now (Current State)

**Use custom models for**:
- General chat and Q&A
- Code generation (manual copy-paste)
- Text processing
- Translation
- Summarization

**Use Copilot models for**:
- Tasks requiring browser control
- File/workspace operations
- Terminal commands
- Any tool-dependent workflow

### Future Enhancement Path

If you want custom models with tool access:

1. **Phase 1**: Add tool proxy to router (1-2 days)
   - Router exposes tool execution API
   - Extension can request tool calls
   - Router executes via its MCP client

2. **Phase 2**: Implement tool calling in provider (2-3 days)
   - Provider sends tool definitions to LLM
   - LLM requests tool execution
   - Router executes and returns results
   - LLM generates final response

3. **Phase 3**: Full integration (3-5 days)
   - Seamless tool experience
   - Tool definitions passed to models
   - Automatic tool selection by LLM

---

## Technical Details

### VS Code Language Model API Limitations

From `vscode.d.ts` (v1.107.0):

```typescript
export interface LanguageModelChatProvider {
  provideLanguageModelChatResponse(
    model: LanguageModelChatInformation,
    messages: readonly LanguageModelChatRequestMessage[],
    options: ProvideLanguageModelChatResponseOptions,  // No tools here!
    progress: Progress<LanguageModelResponsePart>,
    token: CancellationToken
  ): Thenable<void>;
}

export interface ProvideLanguageModelChatResponseOptions {
  // Only contains internal flags, no tool definitions
  readonly justification?: string;
}
```

**Contrast with OpenAI's API**:
```typescript
// OpenAI has explicit tool support
const response = await openai.chat.completions.create({
  model: "gpt-4",
  messages: [...],
  tools: [  // ← Tools ARE passed
    { type: "function", function: { name: "get_weather", ... } }
  ],
  tool_choice: "auto"
});
```

**The Gap**: VS Code's LM Provider API does not expose the `tools` parameter to third-party providers.

---

## Testing Your Current Setup

### Test 1: Pure Chat (Should Work ✅)

```
1. Select your custom model
2. Type: "Explain how async/await works in JavaScript"
3. Expected: Model responds with explanation ✅
```

### Test 2: Tool Request (Will Not Work ❌)

```
1. Select your custom model
2. Type: "@browser Go to google.com"
3. Expected: 
   - Model receives "@browser Go to google.com" as TEXT
   - Model CANNOT execute browser commands
   - Model might respond: "I can't control browsers"
```

### Test 3: Copilot with Tools (Should Work ✅)

```
1. Select Copilot model (GPT-4, Claude)
2. Type: "@browser Go to google.com"
3. Expected: Browser navigates to google.com ✅
```

---

## Conclusion

**Current Reality**: Custom models registered via the Language Model Provider API are **chat-only**. They cannot access Antigravity's built-in tools.

**Your Options**:
1. Accept text-only limitation (simplest)
2. Implement tool proxy in router (recommended for full functionality)
3. Wait for VS Code to add tool support to third-party providers (unknown timeline)

**Best Path Forward**: 
- Deploy current implementation for chat use cases
- Plan tool proxy implementation if tool access is critical
- Document limitation clearly to users

---

## Related Files

- [Language Model Provider API](https://code.visualstudio.com/api/references/vscode-api#LanguageModelChatProvider)
- [VS Code LM API Limitations](https://github.com/microsoft/vscode/issues/223532)
- [Antigravity Custom Models Plan](../antigravity-custom-models.md)
- [Hybrid Architecture](./HYBRID_ARCHITECTURE.md)
