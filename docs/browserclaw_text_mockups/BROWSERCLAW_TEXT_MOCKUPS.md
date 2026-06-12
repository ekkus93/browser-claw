# BrowserClaw Text-Based UI Mockups

These mockups are intended for Claude Code or another coding agent to implement the UI without relying only on image interpretation.

The visual target is a clean, desktop-class, light-theme AI agent console:
- left navigation rail;
- top status bar;
- main page content;
- right inspector panel where useful;
- cards, tabs, badges, tables, forms, approval cards.

Use the SVG/PNG mockups only as visual references. Treat this markdown as the canonical structural description.

---

# Shared App Shell

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ BrowserClaw                                      ● wllama • SmolLM2  Storage │
│                                                  1.42GB / 5GB   [Settings]   │
├───────────────┬───────────────────────────────────────────────┬──────────────┤
│ Sidebar       │ Main page content                             │ Inspector    │
│               │                                               │ optional     │
│ Chat          │                                               │              │
│ Models        │                                               │              │
│ Storage       │                                               │              │
│ Skills        │                                               │              │
│ Memories      │                                               │              │
│ Audit         │                                               │              │
│ Settings      │                                               │              │
│               │                                               │              │
│ Runtime       │                                               │              │
│ ● ready       │                                               │              │
└───────────────┴───────────────────────────────────────────────┴──────────────┘
```

## Shared Top Bar

Left:
- BrowserClaw logo icon.
- BrowserClaw wordmark.

Right:
- active provider/model pill:
  - green dot;
  - text: `wllama • SmolLM2`;
  - clickable to open model/provider selector.
- storage usage pill:
  - database icon;
  - text: `Storage 1.42 GB / 5.00 GB`;
  - horizontal usage bar.
- Settings button.

## Shared Sidebar

Items:
- Chat
- Models
- Storage
- Skills
- Memories
- Audit
- Settings

Active item:
- light blue background;
- blue icon/text;
- semibold label.

Bottom runtime card:
```text
┌────────────────────────┐
│ ● Runtime              │
│ BrowserClaw runtime    │
│ is ready               │
│ View status >          │
└────────────────────────┘
```

Footer:
- `v0.7.0`
- small green status dot.

## Shared Right Inspector

Use where helpful.

Tabs:
```text
Tool Calls | Context | Memory | Skills | Audit
```

Each tab shows a contextual summary:
- Tool Calls: recent tool calls/proposed actions.
- Context: runtime environment, provider, model, data location.
- Memory: retrieved memories, recently used, stats.
- Skills: active skills, skill state, skill audit events.
- Audit: recent events, approvals, risk metrics.

---

# 01 — Onboarding / First Run Setup

Route: `/onboarding`

Purpose:
Help the user configure BrowserClaw for the first time.

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ Welcome to BrowserClaw!                                                     │
│ Let's get you set up in a few simple steps.                                  │
│                                                                              │
│   1 Choose inference mode ── 2 Set up storage ── 3 Configure model ── 4 Finish│
│                                                                              │
│ 1. Choose your inference mode                                                 │
│ Select how BrowserClaw should run AI models for your workspace.              │
│                                                                              │
│ ┌─────────────────────────┐ ┌─────────────────────────┐ ┌──────────────────┐ │
│ │ ◉ Run browser-local     │ │ ○ Connect to Ollama     │ │ ○ Use OpenAI /   │ │
│ │   model with wllama     │ │   or llama-server       │ │   Anthropic      │ │
│ │ [Recommended]           │ │                         │ │                  │ │
│ │                         │ │                         │ │                  │ │
│ │ ✓ 100% local/private    │ │ ✓ Use local models      │ │ ✓ Frontier models│ │
│ │ ✓ Works offline         │ │ ✓ Flexible endpoints    │ │ ✓ Always updated │ │
│ │ ✓ No API costs          │ │ ✓ Leverages hardware    │ │ ✓ Managed APIs   │ │
│ │ ✓ Best personal mode    │ │ ✓ Works over LAN        │ │ ✓ Internet req.  │ │
│ │ [Requires RAM]          │ │ [Requires local server] │ │ [API fees apply] │ │
│ └─────────────────────────┘ └─────────────────────────┘ └──────────────────┘ │
│                                                                              │
│ 🔒 Your data stays private. API keys and sensitive settings are encrypted     │
│ locally in your browser.                                                      │
│                                                                              │
│                                                   [Back] [Continue →]         │
└──────────────────────────────────────────────────────────────────────────────┘

Right panel:
┌────────────────────────────┐
│ Setup overview             │
│                            │
│ ① Choose inference mode    │
│ ② Set up storage           │
│ ③ Configure API/local model│
│ ④ Finish                   │
└────────────────────────────┘

┌────────────────────────────┐
│ Need help?                 │
│ View setup guide           │
└────────────────────────────┘
```

Behavior:
- First card selected by default.
- Continue advances to storage setup.
- If the user chooses browser-local mode, next step offers a small GGUF model download.
- If the user chooses local endpoint mode, next step asks for Ollama/llama-server URL.
- If the user chooses OpenAI/Anthropic, next step asks for key mode and warns about browser-direct keys.

---

# 02 — Chat / Workbench

Route: `/chat`

Purpose:
Primary interaction surface.

```text
┌───────────────────────────────────────────────┬──────────────────────────────┐
│ Chat / Workbench                              │ Tool Calls | Context | ...   │
│ Your local-first AI agent console.            │                              │
│                                               │ Recent tool calls/actions     │
│ ┌───────────────────────────────────────────┐ │ ┌──────────────────────────┐ │
│ │ BrowserClaw 10:32 AM                      │ │ │ Save memory (proposed)   │ │
│ │ Welcome to BrowserClaw!                   │ │ │ Rust/WASM architecture   │ │
│ │ I'm your local AI agent...                │ │ │ [Pending]                │ │
│ └───────────────────────────────────────────┘ │ └──────────────────────────┘ │
│                                               │ ┌──────────────────────────┐ │
│ You 10:33 AM                                  │ │ Web search               │ │
│ Can you explain Rust/WASM architecture?       │ │ rust wasm architecture   │ │
│                                               │ │ [Success]                │ │
│ BrowserClaw 10:33 AM                          │ └──────────────────────────┘ │
│ Sure. I'll draft an explanation and save it.  │                              │
│                                               │ Memory retrieved             │
│ ┌───────────────────────────────────────────┐ │ - Rust ownership basics      │
│ │ Proposed action                           │ │ - WebAssembly concepts       │
│ │                                           │ │                              │
│ │ Save memory                       Risk Low│ │ Active skills                │
│ │ Title: Rust/WASM architecture overview    │ │ [Web Search] [Page Reader]   │
│ │ Body: Overview of Rust/WASM architecture  │ │ [Code Analyzer]              │
│ │                                           │ │                              │
│ │ [Approve] [Edit] [Reject]                 │ │ Recent audit events          │
│ └───────────────────────────────────────────┘ │ - Model loaded               │
│                                               │ - Skill enabled              │
│ ┌───────────────────────────────────────────┐ │ - Approval required          │
│ │ Ask anything or give a command...         │ │                              │
│ │ [Attach] Type / for commands       [Send] │ │                              │
│ └───────────────────────────────────────────┘ │                              │
└───────────────────────────────────────────────┴──────────────────────────────┘
```

Key components:
- `ChatThread`
- `MessageBubble`
- `ApprovalCard`
- `ChatComposer`
- `RightInspectorPanel`
- `ToolCallList`
- `RetrievedMemoryCard`
- `ActiveSkillsCard`
- `RecentAuditCard`

Approval card fields:
- action type;
- risk;
- exact payload;
- approve/edit/reject buttons.

Rules:
- Any side-effectful action must appear as an approval card before execution.
- The user can edit proposed tool payloads before approving.
- The runtime status footer should show `Runtime is ready | All systems operational | Local mode`.

---

# 03 — Models

Route: `/models`

Purpose:
Configure remote APIs, local endpoints, and browser-local GGUF models.

```text
┌────────────────────────────────────────────────────┬─────────────────────────┐
│ Models                                             │ Provider Health         │
│ Configure AI providers and manage local models.    │                         │
│                                                    │ OpenAI          ● OK    │
│ Remote Providers                                   │ Anthropic       ● OK    │
│ ┌───────────────┐ ┌───────────────┐ ┌────────────┐ │ OpenAI compat   ● CORS  │
│ │ OpenAI        │ │ Anthropic     │ │ Compatible │ │ Ollama          ● OK    │
│ │ [Connected]   │ │ [Connected]   │ │ [CORS]     │ │ llama-server    ● OK    │
│ │ Base URL      │ │ Base URL      │ │ Base URL   │ │ wllama          ○ N/A   │
│ │ Model         │ │ Model         │ │ Model      │ │                         │
│ │ Key mode      │ │ Key mode      │ │ Key mode   │ │ [Test All]              │
│ │ [Test]        │ │ [Test]        │ │ [Test]     │ └─────────────────────────┘
│ └───────────────┘ └───────────────┘ └────────────┘ │
│                                                    │ Model Download Queue    │
│ Local Endpoints                                    │ ┌─────────────────────┐ │
│ ┌───────────────┐ ┌───────────────┐                │ │ Mistral GGUF 68%    │ │
│ │ Ollama        │ │ llama-server  │                │ │ Phi-3 queued        │ │
│ │ localhost:114 │ │ localhost:808 │                │ └─────────────────────┘ │
│ │ [Connected]   │ │ [Connected]   │                │                         │
│ └───────────────┘ └───────────────┘                │ Troubleshooting Tips    │
│                                                    │ - CORS issue            │
│ Browser-Local Models                               │ - Model not found       │
│ ┌────────────────────────────────────────────────┐ │ - Connection failed     │
│ │ Model                         Status   Actions │ │                         │
│ │ SmolLM2 Q4 GGUF               Loaded   Load Del│ │                         │
│ │ Mistral Q4 GGUF               68%      Pause   │ │                         │
│ │ Phi-3 mini Q4 GGUF            Not DL   Download│ │                         │
│ └────────────────────────────────────────────────┘ │                         │
└────────────────────────────────────────────────────┴─────────────────────────┘
```

Provider cards fields:
- title;
- provider status;
- base URL;
- model name;
- API key mode;
- test provider button;
- overflow menu.

wllama model table fields:
- display name;
- Hugging Face repo/file;
- size;
- status;
- storage used;
- actions.

Errors to display:
- CORS issue;
- authentication failed;
- model not found;
- endpoint unreachable;
- storage quota insufficient.

---

# 04 — Storage / Backup

Route: `/storage`

Purpose:
Manage local database, model cache, persistent storage, backup/restore.

```text
┌───────────────────────────────────────────────┬──────────────────────────────┐
│ Storage / Backup                              │ Recent Backups               │
│ Manage local data, backups, and storage.      │                              │
│                                               │ Manual backup 1.24GB Success │
│ Storage Overview                              │ Auto backup   1.18GB Success │
│ ┌──────────────┐ ┌──────────────┐ ┌─────────┐ │ Manual backup 1.12GB Success │
│ │ IndexedDB    │ │ Model Cache  │ │ Persist │ │ Auto backup enabled          │
│ │ 1.42 GB      │ │ 892 MB       │ │ Granted │ │                              │
│ │ 28% quota    │ │ 44% quota    │ │ [Manage]│ │ Local Data Health            │
│ └──────────────┘ └──────────────┘ └─────────┘ │ ✓ IndexedDB Healthy          │
│                                               │ ✓ Cache Storage Healthy      │
│ Backup & Restore                              │ ✓ Local Storage Healthy      │
│ [Export Backup] [Import Backup] [Request]     │ ✓ Service Worker Healthy     │
│                                               │ ✓ Quota Good                 │
│ What's included in backups                    │                              │
│ - Conversations                               │ Storage Recommendations      │
│ - Tasks                                       │ - Usage normal               │
│ - Memories                                    │ - Model cache using 892MB    │
│ - Skills                                      │ - 3.58GB available           │
│ - Optional encrypted secrets                  │                              │
│ - Model references, not model files           │                              │
│                                               │                              │
│ Future Integrations                           │                              │
│ Google Drive sync coming later                │                              │
└───────────────────────────────────────────────┴──────────────────────────────┘
```

Backup rules:
- Backup includes app database records.
- Backup does not include large model files by default.
- Backup includes model references.
- Encrypted secrets are optional.
- Google Drive support later must upload only encrypted backups.

---

# 05 — Skills

Route: `/skills`

Purpose:
Install/manage Pi/OpenClaw-style skills.

```text
┌────────────────────────────────────┬────────────────────────────┬─────────────┐
│ Skills                             │ Selected Skill             │ Skills tab  │
│ Install and configure skills.      │ summarize-pdf [Enabled]    │             │
│                                    │                            │ Active      │
│ Installed Skills                   │ Tabs:                      │ - summarize │
│ ┌──────────────────────────────┐   │ Overview Instructions      │ - daily     │
│ │ summarize-pdf          ON    │   │ Files Permissions State    │             │
│ │ Risk Low, last used 2m       │   │ Audit                      │ Summary     │
│ └──────────────────────────────┘   │                            │ installed 4 │
│ ┌──────────────────────────────┐   │ Permissions                │ enabled 2   │
│ │ daily-review           ON    │   │                            │ disabled 2  │
│ └──────────────────────────────┘   │ Allowed Tools              │             │
│                                    │ - Page Reader      Allowed │ Recent      │
│ Bundled Skills                     │ - File Reader      Allowed │ - executed  │
│ ┌──────────────────────────────┐   │ - Web Search       Allowed │ - disabled  │
│ │ web-search             OFF   │   │                            │ - installed │
│ └──────────────────────────────┘   │ Skill Filesystem Access    │             │
│ ┌──────────────────────────────┐   │ Read: /skills/.../data/**  │             │
│ │ code-analyzer          OFF   │   │ Write: /skills/.../out/**  │             │
│ └──────────────────────────────┘   │                            │             │
│                                    │ Network Access: Allowed    │             │
│ Import Skill                       │                            │             │
│ Drop .clawskill or SKILL.md here   │                            │             │
└────────────────────────────────────┴────────────────────────────┴─────────────┘
```

Skill model:
- Package files are read-only after install.
- Skill state is private and mutable.
- Shared app data only via declared tools.
- No raw IndexedDB/OPFS.
- No arbitrary filesystem.
- No user file access without picker approval.

---

# 06 — Memories

Route: `/memories`

Purpose:
Search, inspect, edit, and manage persistent memories.

```text
┌───────────────────────────────────────────────┬──────────────────────────────┐
│ Memories                                      │ Overview | Recently | History│
│ Search, view, manage knowledge memories.      │                              │
│                                               │ Memory stats                 │
│ [Search memories...] [Filters]                │ Total memories: 42           │
│ Tags [All] Source [All] Created by [All]      │ Pinned: 7                    │
│ Sensitivity [All]                             │ Last 7 days: 12              │
│                                               │ Avg relevance: 0.86          │
│ ┌───────────────────────┬───────────────────┐ │ Storage: 18.4MB              │
│ │ Memory list           │ Memory detail     │ │                              │
│ │                       │                   │ │ Recently used                │
│ │ > Rust/WASM overview  │ Rust/WASM...      │ │ - Rust/WASM overview         │
│ │   tags: rust wasm     │ [Edit][Pin][Del]  │ │ - WASM memory model          │
│ │                       │                   │ │ - Rust ownership             │
│ │ WebAssembly memory    │ Title             │ │ - JS interop                 │
│ │ Rust ownership        │ Summary           │ │                              │
│ │ WASM + JS interop     │ Tags              │ │ Retrieval history            │
│ │                       │ Source convo      │ │ - Rust/WASM score 0.92       │
│ │                       │ Created by        │ │ - WASM score 0.88            │
│ │                       │ Sensitivity       │ │ - Ownership score 0.84       │
│ │                       │ Provenance        │ │                              │
│ │                       │ Related memories  │ │                              │
│ └───────────────────────┴───────────────────┘ │                              │
└───────────────────────────────────────────────┴──────────────────────────────┘
```

Required memory fields:
- id;
- title;
- summary/body;
- tags;
- source conversation;
- source message;
- created by;
- created at;
- last used at;
- sensitivity;
- pinned.

---

# 07 — Audit

Route: `/audit`

Purpose:
Transparent chronological record of system actions.

```text
┌───────────────────────────────────────────────┬──────────────────────────────┐
│ Audit                                         │ Audit tab                    │
│ Chronological record of system events.        │                              │
│                                               │ Audit summary                │
│ Filters:                                      │ Total 124                    │
│ [Event type] [Risk] [Conversation] [Provider] │ Success 98                   │
│ [Tool] [Date range] [Clear]                   │ Failed 2                     │
│                                               │ Users/Sources 24             │
│ ┌───────────────────────────────────────────┐ │                              │
│ │ Time       Event          Source Risk Stat│ │ Risk breakdown               │
│ │ 10:33 AM   LLM request    Chat   Low  OK  │ │ Low 79%                      │
│ │            sent                           │ │ Medium 16%                   │
│ │                                           │ │ High 3%                      │
│ │ Event details                             │ │ Critical 2%                  │
│ │ ID: evt_...                               │ │                              │
│ │ Provider: SmolLM2                         │ │ Recent approvals             │
│ │ Tokens: 1248 / 512                        │ │ - Save memory                │
│ │ Latency: 1.42s                            │ │ - Web search                 │
│ │                                           │ │ - Install skill              │
│ │ Details JSON                              │ │ - Unlock secret              │
│ │ { "event": "llm.request.sent", ... }     │ │                              │
│ │                                           │ │ Top event sources            │
│ │ 10:32 AM Memory created      OK           │ │ BrowserClaw                  │
│ │ 10:31 AM Skill installed     OK           │ │ You                          │
│ │ 10:31 AM Secret unlocked     OK           │ │ Chat                         │
│ │ 10:30 AM Backup exported     OK           │ │                              │
│ └───────────────────────────────────────────┘ │ [Export CSV]                 │
└───────────────────────────────────────────────┴──────────────────────────────┘
```

Audit events must be immutable after creation except for retention/cleanup operations.

---

# 08 — Settings

Route: `/settings`

Purpose:
Configure global app behavior.

```text
┌───────────────────────────────────────────────┬──────────────────────────────┐
│ Settings                                      │ Context tab                  │
│ Configure workflow and security preferences.  │                              │
│                                               │ Environment                  │
│ ┌──────────────┐ ┌──────────────┐ ┌─────────┐ │ Provider: wllama             │
│ │ General      │ │ Models       │ │ Security│ │ Model: SmolLM2               │
│ │ Theme        │ │ Default prov │ │ Key mode│ │ Runtime: Running             │
│ │ Language     │ │ Default model│ │ Timeout │ │ Mode: Local                  │
│ │ Auto-start   │ │ Fallback     │ │ Approve │ │ Data: IndexedDB              │
│ │ Minimize     │ │              │ │ Warning │ │ Keys: Browser IndexedDB      │
│ └──────────────┘ └──────────────┘ └─────────┘ │                              │
│ ┌──────────────┐ ┌──────────────┐ ┌─────────┐ │ Version                      │
│ │ Storage      │ │ Skills       │ │ Dev     │ │ BrowserClaw v0.7.0           │
│ │ Data location│ │ Install pol. │ │ Logs    │ │ Runtime v0.7.0               │
│ │ Auto-backup  │ │ Unsigned     │ │ Level   │ │ UI build 2025.05.18          │
│ │ Frequency    │ │ Auto-update  │ │ Dev mode│ │ Up to date                   │
│ │ Keep backups │ │ Publishers   │ │ Reset   │ │                              │
│ └──────────────┘ └──────────────┘ └─────────┘ │ Quick actions                │
│                                               │ - Restart runtime            │
│                                               │ - Check updates              │
│                                               │ - View privacy policy        │
└───────────────────────────────────────────────┴──────────────────────────────┘
```

Security warning:
Browser-direct API keys are stored in the browser and can be accessed by scripts running on this origin. Use trusted deployments only.

---

# 09 — User Workflow

Route: `/workflow`

Purpose:
Explain app flow and trust model.

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ User Workflow                                                                │
│ See how BrowserClaw turns your intent into trusted, local AI actions.        │
│                                                                              │
│ ┌─────────────┐ → ┌─────────────┐ → ┌─────────────┐ → ┌─────────────┐        │
│ │ 1 First Run │   │ 2 Choose    │   │ 3 Start     │   │ 4 Retrieve  │        │
│ │ Setup       │   │ Model/Prov. │   │ Chat/Intent │   │ Memory/Skill│        │
│ └─────────────┘   └─────────────┘   └─────────────┘   └─────────────┘        │
│          ↓                                                                   │
│ ┌─────────────┐ → ┌─────────────┐ → ┌─────────────┐ → ┌─────────────┐        │
│ │ 5 Agent     │   │ 6 User      │   │ 7 Save to   │   │ 8 Backup /  │        │
│ │ Proposes    │   │ Approves    │   │ Memory/Audit│   │ Restore     │        │
│ └─────────────┘   └─────────────┘   └─────────────┘   └─────────────┘        │
│                                                                              │
│ Right panel: Typical User Journey                                             │
│ - Onboard                                                                    │
│ - Ask a question                                                              │
│ - Approve actions                                                             │
│ - Review memory                                                               │
│ - Export backups                                                              │
│                                                                              │
│ 🛡 Your data stays local and private unless you choose remote/export actions. │
└──────────────────────────────────────────────────────────────────────────────┘
```
