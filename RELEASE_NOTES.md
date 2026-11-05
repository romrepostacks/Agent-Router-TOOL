# Release notes

## 0.10.1

First public release of Local Agent Router, a Windows desktop app that sends each request to the AI tool best suited for it: Claude Code, Codex, Copilot, a local model, or OpenAI and Anthropic API keys.

### Install
1. Download **Local Agent Router-0.10.1 Setup.exe** below and run it. The installer isn't code-signed yet, so Windows SmartScreen may warn you: click **More info**, then **Run anyway**.
2. On first launch, a 6-step setup guide walks you through your projects folder, installing or signing in to the AI tools you use (skip any you don't have), an optional local model, and optional API keys.

### What's in 0.10.1
- First-run setup guide with Install, Sign in and Skip for each AI tool, plus Node.js when needed.
- Routes pick from the tools you actually have and fall through to the next one when a tool is missing.
- OpenAI and Anthropic API keys, encrypted with Windows.
- Any OpenAI-compatible local model (Ollama, LM Studio, Colibri).
- Start menu and desktop shortcuts.
- Your skills live in your own data folder (`%LOCALAPPDATA%\LocalAgentRouterData`) and survive updates.
