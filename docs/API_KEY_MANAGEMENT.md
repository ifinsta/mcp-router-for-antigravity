# API Key Management UI

## Overview

The MCP Router extension provides a beautiful, secure webview panel for managing API keys for all supported LLM providers. Keys are stored using VS Code's encrypted secret storage.

## Features

- 🔐 **Secure Storage**: API keys stored in VS Code's secret storage (encrypted)
- 🎨 **Modern UI**: Clean, VS Code-themed interface
- ✅ **Test Connection**: Verify API keys work before using them
- 🔄 **Real-time Status**: Visual indicators show which providers are configured
- 🗑️ **Easy Management**: Add, update, or remove keys with one click
- 📱 **Responsive**: Works in any panel size

## Opening the Settings UI

### Method 1: Command Palette
1. Press `Ctrl+Shift+P` (Windows/Linux) or `Cmd+Shift+P` (macOS)
2. Type: `MCP Router: Configure API Keys`
3. Press Enter

### Method 2: Quick Access
1. Press `Ctrl+P` (Windows/Linux) or `Cmd+P` (macOS)
2. Type: `>MCP Router: Configure API Keys`
3. Press Enter

## Supported Providers

### OpenAI
- **Models**: GPT-4, GPT-4o, GPT-3.5 Turbo, and more
- **API**: https://api.openai.com
- **Get Key**: https://platform.openai.com/api-keys

### GLM (Zhipu AI)
- **Models**: GLM-4, GLM-4-Plus, GLM-4-Flash
- **API**: https://open.bigmodel.cn
- **Get Key**: https://open.bigmodel.cn/usercenter/api-keys

### Anthropic
- **Models**: Claude 3 Opus, Sonnet, Haiku
- **API**: https://api.anthropic.com
- **Get Key**: https://console.anthropic.com/settings/keys

## Using the UI

### Adding an API Key

1. Open the settings UI (see above)
2. Find the provider card (e.g., "OpenAI")
3. Enter your API key in the input field
4. Click **Save Key**
5. Status badge changes to "✓ Configured"

### Testing a Connection

1. Ensure an API key is saved
2. Click **Test Connection** button
3. Wait for the result message:
   - ✅ Green: Connection successful
   - ❌ Red: Connection failed (check the error message)

### Removing an API Key

1. Find the configured provider
2. Click **Remove** button
3. Confirm the deletion
4. Status badge changes to "✗ Not Configured"

### Refreshing Status

Click the **↻ Refresh** button in the top-right corner to update all provider statuses.

## Security

### How Keys Are Stored

- Keys are stored using `vscode.SecretStorage` API
- On Windows: Stored in Windows Credential Manager
- On macOS: Stored in Keychain
- On Linux: Stored in libsecret (GNOME Keyring or KWallet)

### Security Features

- ✅ Keys are **encrypted at rest**
- ✅ Keys are **never logged**
- ✅ Keys are **never sent to third parties**
- ✅ Keys are **masked in UI** (shown as ••••••••)
- ✅ Keys are **only sent to your local MCP Router**

### What We Don't Do

- ❌ Don't store keys in plaintext
- ❌ Don't send keys to analytics
- ❌ Don't include keys in error reports
- ❌ Don't sync keys across machines

## Troubleshooting

### "No API key configured" Error

**Problem**: Test Connection fails with this message

**Solution**:
1. Make sure you've saved an API key first
2. Verify the key is correct (no extra spaces)
3. Check that the key hasn't expired

### "Connection test failed" Error

**Problem**: Test Connection fails

**Solutions**:
1. **Check router is running**: `npm run dev` in the router directory
2. **Verify API key is valid**: Test it with curl:
   ```bash
   curl -H "Authorization: Bearer YOUR_KEY" https://api.openai.com/v1/models
   ```
3. **Check network**: Ensure you have internet access
4. **Check provider status**: Provider might be down

### UI Not Opening

**Problem**: Command doesn't open the panel

**Solutions**:
1. Check extension is installed and enabled
2. Reload VS Code: `Ctrl+Shift+P` → "Developer: Reload Window"
3. Check extension output channel for errors

### Key Not Persisting

**Problem**: Keys disappear after restart

**Solutions**:
1. Check VS Code secret storage is working
2. Try restarting VS Code completely
3. On Linux, ensure libsecret is installed:
   ```bash
   sudo apt install libsecret-1-0
   ```

## Integration with Router

### Automatic Synchronization ✅

**The extension now automatically syncs API keys to the router!**

When you save an API key in the extension UI:
1. Key is stored in VS Code's encrypted secret storage (local)
2. Key is **automatically pushed** to the router via HTTP API
3. Router updates its configuration **without restart**
4. Provider becomes immediately available for use

**No manual `.env` editing required!** 🎉

### How It Works

```
User saves API key in extension UI
     ↓
Extension stores in VS Code SecretStorage (encrypted)
     ↓
Extension calls POST /api/extension/keys
     ↓
Router receives key and updates config
     ↓
Provider is immediately ready to use
```

### Fallback Behavior

If the router is not running when you save a key:
- ✅ Key is still saved locally in VS Code
- ⚠️ Sync to router fails (logged as warning)
- 💡 Next time router starts, it will read from `.env` or you can re-save the key

### Manual Configuration (Optional)

If you prefer manual configuration or router is offline:

**Option 1: Manual `.env` editing**
1. Copy API key from extension UI
2. Add to router's `.env` file:
   ```env
   OPENAI_API_KEY=sk-your-key-here
   GLM_API_KEY=your-glm-key-here
   ```
3. Restart the router

**Option 2: Environment variables**
```bash
export OPENAI_API_KEY=sk-your-key-here
export GLM_API_KEY=your-glm-key-here
npm run dev
```

## Keyboard Shortcuts

| Action | Shortcut |
|--------|----------|
| Open Command Palette | `Ctrl+Shift+P` / `Cmd+Shift+P` |
| Quick Open | `Ctrl+P` / `Cmd+P` |
| Refresh UI | Click refresh button |

## API Reference

### Extension Commands

| Command | ID | Description |
|---------|-----|-------------|
| Configure API Keys | `mcpRouter.configureApiKeys` | Opens the API key settings panel |

### Messages

#### Extension → Webview

| Command | Data | Description |
|---------|------|-------------|
| `keySaved` | `{ provider, message }` | API key saved successfully |
| `keyRemoved` | `{ provider, message }` | API key removed |
| `testing` | `{ provider }` | Connection test started |
| `testResult` | `{ provider, success, message }` | Test result |
| `error` | `{ provider, message }` | Error occurred |

#### Webview → Extension

| Command | Data | Description |
|---------|------|-------------|
| `saveApiKey` | `{ provider, apiKey }` | Save an API key |
| `removeApiKey` | `{ provider }` | Remove an API key |
| `testConnection` | `{ provider }` | Test provider connection |
| `refresh` | - | Refresh provider statuses |

## Architecture

```
┌─────────────────────────────────────┐
│         Antigravity UI              │
│   (User clicks command)             │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│   ApiKeySettingsPanel               │
│   (Webview UI)                      │
│                                     │
│  ┌──────────────────────────────┐  │
│  │ OpenAI          ✓ Configured │  │
│  │ [••••••••••] [Save] [Test]  │  │
│  └──────────────────────────────┘  │
│                                     │
│  ┌──────────────────────────────┐  │
│  │ GLM            ✗ Not Config  │  │
│  │ [Enter key...] [Save] [Test]│  │
│  └──────────────────────────────┘  │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│   ApiKeyManager                     │
│   (Secret Storage)                  │
│                                     │
│  • vscode.SecretStorage             │
│  • Encrypted at rest                │
│  • Platform-specific backend        │
└─────────────────────────────────────┘
```

## File Structure

```
extension/src/
├── client/
│   └── apiKeyManager.ts      # Secret storage manager
├── ui/
│   └── apiKeySettingsPanel.ts # Webview panel
├── config/
│   └── settings.ts            # Extension configuration
└── extension.ts               # Command registration
```

## Code Examples

### Programmatically Set API Key

```typescript
import { ApiKeyManager } from './client/apiKeyManager';

const manager = new ApiKeyManager(context);
await manager.setApiKey('openai', 'sk-your-key');
```

### Check if Provider is Configured

```typescript
const isConfigured = await manager.isConfigured('openai');
if (isConfigured) {
  console.log('OpenAI is ready to use!');
}
```

### Get All Provider Statuses

```typescript
const providers = await manager.getAllProvidersStatus();
for (const provider of providers) {
  console.log(`${provider.displayName}: ${provider.isConfigured ? '✓' : '✗'}`);
}
```

## Future Enhancements

- [ ] **Automatic router sync**: Push keys to router automatically
- [ ] **Key rotation**: Schedule automatic key rotation
- [ ] **Multiple keys per provider**: Support key pools for rate limiting
- [ ] **Key validation**: Validate key format before saving
- [ ] **Import/Export**: Backup and restore keys
- [ ] **Provider-specific settings**: Custom base URLs, timeouts
- [ ] **Usage tracking**: Show API usage per provider
- [ ] **Cost estimation**: Estimate costs based on usage

## Security Best Practices

1. **Never share API keys** in screenshots or logs
2. **Use separate keys** for development and production
3. **Rotate keys regularly** (every 90 days recommended)
4. **Monitor usage** in provider dashboards
5. **Set usage limits** in provider settings
6. **Remove unused keys** promptly
7. **Use environment-specific keys** (dev, staging, prod)

## Related Documentation

- [Hybrid Architecture](./HYBRID_ARCHITECTURE.md)
- [Quick Start Guide](../HYBRID_QUICKSTART.md)
- [VS Code Secret Storage](https://code.visualstudio.com/api/references/vscode-api#SecretStorage)
