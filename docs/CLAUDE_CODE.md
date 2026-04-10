# Claude Code MCP Setup & Quick Start Guide

## 🚀 **QUICK START (5 Minutes)**

### **Step 1: Build Your MCP Router**
```bash
cd c:\Users\user\CascadeProjects\mcp-router-for-antigravity
npm install
npm run build
```

### **Step 2: Configure Claude Code**

**Method A: Using Claude Code Settings**
1. Open Claude Code
2. Go to `Settings` → `MCP Servers`
3. Click `Add MCP Server`
4. Enter:
   - **Name**: `antigravity-browser`
   - **Command**: `node C:\Users\user\CascadeProjects\mcp-router-for-antigravity\dist\index.js`
   - **Timeout**: `30000` (30 seconds)

**Method B: Using Configuration File**
1. Create Claude Code MCP config at `C:\Users\user\.claude\mcp-servers.json`:
```json
{
  "mcpServers": {
    "antigravity-browser": {
      "command": "node",
      "args": ["C:\\Users\\user\\CascadeProjects\\mcp-router-for-antigravity\\dist\\index.js"],
      "env": {
        "NODE_ENV": "production"
      },
      "timeout": 30000
    }
  }
}
```

### **Step 3: Start Using Browser Tools!**

Once configured, you can immediately use browser tools in Claude Code:

```markdown
# Launch a Chrome browser
test_launch_browser --browserType chrome --headless true --url https://example.com

# Navigate to a different page
test_navigate --sessionId <returned-session-id> --url https://example.org

# Take a screenshot
test_screenshot --sessionId <returned-session-id> --fullPage true

# Click an element
test_click --sessionId <returned-session-id> --selector "#submit-button"

# Type in a field
test_type --sessionId <returned-session-id> --selector "#email" --text "user@example.com"

# Wait for an element to appear
test_wait_for --sessionId <returned-session-id> --type "element_visible" --selector "#content"
```

---

## 📋 **COMPLETE SETUP GUIDE**

### **1. System Requirements Check**

**Verify you have:**
```bash
# Node.js (v20+)
node --version  # Should be v20.10.0 or higher

# TypeScript
tsc --version  # Should be v5.3+ or higher

# Build tools
npm --version    # Should be v10+ or higher

# Claude Code (latest version)
# Check in Claude Code: Help → About Claude Code
```

**If missing Node.js 20:**
```bash
# Install Node.js 20+ from https://nodejs.org/
# After installation, restart terminal
```

### **2. Project Setup**

```bash
# Navigate to your project
cd C:\Users\user\CascadeProjects\mcp-router-for-antigravity

# Clean and install
npm ci

# Build the project
npm run build

# Verify build
ls dist/index.js  # Should exist
ls dist/index.d.ts  # Should exist
```

### **3. Test the MCP Server Locally**

```bash
# Start the MCP server in development mode
npm run dev

# In another terminal, test MCP connectivity
# (The server will log connection events)
```

### **4. Configure Claude Code**

#### **Option A: UI Configuration (Easiest)**

1. **Open Claude Code**
2. **Navigate to Settings**
   - Click gear icon ⚙️ in bottom left
   - Select "MCP Servers" from left menu

3. **Add MCP Server**
   - Click "Add MCP Server" button (+)
   - Fill in the form:
     ```
     Name: antigravity-browser
     Command: node "C:\Users\user\CascadeProjects\mcp-router-for-antigravity\dist\index.js"
     Timeout: 30000
     ```
   - Click "Add Server"

4. **Verify Connection**
   - Look for green checkmark next to server name
   - If connection fails, check:
     - File path is correct
     - Node.js is installed
     - Windows path format (use double backslashes)

#### **Option B: Configuration File**

Create/Edit `C:\Users\user\.claude\mcp-servers.json`:

```json
{
  "mcpServers": {
    "antigravity-browser": {
      "command": "node",
      "args": ["C:\\Users\\user\\CascadeProjects\\mcp-router-for-antigravity\\dist\\index.js"],
      "env": {
        "NODE_ENV": "production",
        "LOG_LEVEL": "info"
      },
      "timeout": 30000,
      "alwaysAllow": ["test_launch_browser", "test_navigate", "test_screenshot", "test_click", "test_type"]
    }
  }
}
```

Then restart Claude Code to pick up changes.

### **5. Verify Claude Code Connection**

Once configured, verify in Claude Code:

1. **Check Server Status**
   - Go to Settings → MCP Servers
   - Look for "Connected" status next to "antigravity-browser"
   - Should see green checkmark

2. **Test Tool Discovery**
   - Open a new Claude Code chat
   - Type: `/mcp` or "What MCP tools are available?"
   - You should see your browser tools listed

---

## 🚀 **USE BROWSER TOOLS RIGHT AWAY**

### **Quick Examples for Claude Code**

#### **Example 1: Launch and Test a Website**

```markdown
# Start Chrome and test example.com
test_launch_browser --browserType chrome --headless true --url https://example.com

# Navigate to test page
test_navigate --sessionId <session-id> --url https://example.com/test

# Take screenshot
test_screenshot --sessionId <session-id> --fullPage false

# Click a button
test_click --sessionId <session-id> --selector "#get-started-button"

# Type in search
test_type --sessionId <session-id> --selector "#search" --text "Claude Code testing"
```

#### **Example 2: Advanced Interactions**

```markdown
# Drag and drop elements
test_drag_drop --sessionId <session-id> --sourceSelector "#draggable" --targetSelector "#dropzone"

# Right-click on element
test_right_click --sessionId <session-id> --selector "#context-menu" --button right

# Double-click to activate
test_double_click --sessionId <session-id> --selector "#double-click-target" --interval 50

# Hover over element
test_hover --sessionId <session-id> --selector "#hover-target" --duration 1000

# Scroll to specific section
test_execute_script --sessionId <session-id> --script "document.querySelector('#footer').scrollIntoView({ behavior: 'smooth' })"
```

#### **Example 3: Form Automation**

```markdown
# Fill out a login form
test_fill_form --sessionId <session-id> --form '{"username":{"value":"testuser"},"password":{"value":"testpass"}}'

# Submit the form
test_click --sessionId <session-id> --selector "#submit-button"

# Wait for success message
test_wait_for --sessionId <session-id> --type "element_visible" --selector ".success-message" --timeout 10000

# Take final screenshot
test_screenshot --sessionId <session-id> --fullPage true
```

#### **Example 4: Multi-Tab Operations**

```markdown
# Open a new tab
test_execute_script --sessionId <session-id> --script "window.open('https://example.org', '_blank');"

# Switch back to original tab
test_execute_script --sessionId <session-id> --script "window.focus();"

# Close current tab
test_close_session --sessionId <session-id> --cleanup true
```

---

## 🔍 **TROUBLESHOOTING**

### **Common Issues & Solutions**

#### **Issue 1: Claude Code Can't Connect**

**Symptoms:**
- Shows "Connection failed" or "Unable to connect"
- No green checkmark appears

**Solutions:**
```bash
# 1. Verify MCP server is running
npm run dev

# 2. Check port availability
netstat -ano | findstr "9315"  # Should show LISTENING

# 3. Test MCP server health
# In new terminal:
curl http://localhost:9315/health

# 4. Check firewall/antivirus
# Windows: Allow node.exe through Windows Firewall
# Antivirus: Add exception for node.exe and dist/index.js
```

#### **Issue 2: Tools Not Visible in Claude Code**

**Symptoms:**
- MCP server is connected
- Tools don't appear in tool list

**Solutions:**
```bash
# 1. Restart Claude Code completely
# Close Claude Code completely
# Reopen Claude Code

# 2. Clear MCP cache
# In Claude Code: Settings → Clear MCP Cache

# 3. Remove and re-add server
# Settings → MCP Servers → Remove → Add again

# 4. Check tool registration
# Look in MCP server logs for "registering tool" messages
```

#### **Issue 3: Browser Launch Fails**

**Symptoms:**
- `test_launch_browser` returns error
- "Browser not found" or similar errors

**Solutions:**
```bash
# 1. Check Chrome installation
where chrome
# Should return path to chrome.exe

# 2. Verify headless mode support
# Chrome must support --headless=new flag

# 3. Check user data directory permissions
# Ensure Windows allows creating temp directories

# 4. Test with different browser
test_launch_browser --browserType edge  # Edge often more compatible
```

#### **Issue 4: Tool Execution Times Out**

**Symptoms:**
- Commands hang indefinitely
- Timeout errors

**Solutions:**
```bash
# 1. Increase timeout in Claude Code MCP config
# In Settings → MCP Servers → Edit → Increase timeout to 60000

# 2. Check for blocking operations
# Avoid very long script executions

# 3. Monitor system resources
# Check CPU and memory usage
```

---

## 🎯 **BEST PRACTICES**

### **For Stable Operation**

```bash
# 1. Use headless mode for automation
test_launch_browser --browserType chrome --headless true

# 2. Use appropriate wait conditions
test_wait_for --sessionId <id> --type "network_idle"  # More reliable than element_visible

# 3. Close sessions when done
test_close_session --sessionId <id> --cleanup true

# 4. Handle errors gracefully
# Always wrap tool calls in try-catch blocks
```

### **For Development**

```bash
# 1. Watch mode for development
npm run dev  # Auto-rebuilds on changes

# 2. Use type checking
npm run typecheck  # Catch TypeScript errors early

# 3. Run tests before deploying
npm test  # Ensure browser tools work correctly
```

### **For Production**

```bash
# 1. Use production build
npm run build  # Optimized build

# 2. Set NODE_ENV=production
set NODE_ENV=production
npm start

# 3. Use proper logging
# Logs will show detailed information
```

---

## 📚 **ADVANCED USAGE**

### **Complex Workflows**

#### **Workflow 1: E-commerce Testing**

```markdown
# Start browser
test_launch_browser --browserType chrome --headless true

# Navigate to product
test_navigate --sessionId <id> --url https://shop.example.com/product/123

# Check if product is in stock
test_wait_for --sessionId <id> --type "element_visible" --selector ".stock-status"

# Add to cart
test_click --sessionId <id> --selector "#add-to-cart"

# Navigate to cart
test_navigate --sessionId <id> --url https://shop.example.com/cart

# Verify cart contents
test_execute_script --sessionId <id> --script "document.querySelector('.cart-count').textContent"

# Take screenshot
test_screenshot --sessionId <id> --fullPage true

# Cleanup
test_close_session --sessionId <id>
```

#### **Workflow 2: Performance Testing**

```markdown
# Launch browser
test_launch_browser --browserType chrome --headless true

# Measure baseline performance
perf_measure_realworld --url https://example.com --duration 10000

# Navigate to different page
test_navigate --sessionId <id> --url https://example.com/heavy-page

# Measure heavy page performance
perf_measure_realworld --url https://example.com/heavy-page --duration 10000

# Get performance comparison
# Use the returned metrics to compare

# Close session
test_close_session --sessionId <id>
```

#### **Workflow 3: Form Testing**

```markdown
# Navigate to form
test_navigate --sessionId <id> --url https://example.com/contact

# Test form validation
test_click --sessionId <id> --selector "#submit-button"
test_wait_for --sessionId <id> --type "element_visible" --selector ".error-message" --timeout 3000

# Fill form fields
test_fill_form --sessionId <id> --form '{"name":{"value":"Test User"},"email":{"value":"test@example.com"},"message":{"value":"Test message"}}'

# Submit form
test_click --sessionId <id> --selector "#submit-button"

# Verify success
test_wait_for --sessionId <id> --type "element_visible" --selector ".success-message" --timeout 5000

# Take screenshot
test_screenshot --sessionId <id> --fullPage true

# Cleanup
test_close_session --sessionId <id>
```

---

## 🎉 **SUCCESS CRITERIA**

You'll know it's working when:

✅ **Claude Code Connection:**
   - Green checkmark appears next to "antigravity-browser" in Settings
   - No connection errors in logs

✅ **Tool Discovery:**
   - Browser tools appear in Claude Code's tool list
   - Tool descriptions are visible when you type
   - Tool parameters are suggested

✅ **Browser Control:**
   - Chrome launches successfully
   - Navigation works
   - Screenshots are captured
   - Clicks and typing work
   - No timeout errors

✅ **Full Workflow:**
   - Can launch browser and test website
   - Can perform complex multi-step operations
   - Can close sessions cleanly

---

## 📞 **GETTING HELP**

If you encounter issues:

1. **Check the logs** - Look at MCP server terminal output
2. **Verify paths** - Ensure file paths are correct
3. **Test locally first** - Run MCP server independently
4. **Check Claude Code version** - Ensure you have latest version
5. **Restart everything** - Restart both MCP server and Claude Code

---

## 🚀 **You're Ready to Go!**

Once you've completed the setup, you can immediately start using browser automation capabilities in Claude Code:

```markdown
# Quick test
test_launch_browser --browserType chrome --headless true --url https://example.com

# You should see:
# 1. Chrome browser launches
# 2. Session ID is returned
# 3. You can use all browser tools
```

**Happy automating!** 🎯