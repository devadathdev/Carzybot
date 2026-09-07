# Crazy Bot

Local-first multi-agent personal AI workspace.

## Modes
Crazy, Code, Research, Plan, Analyze, Create and Files.

## Agents
Orchestrator, Reasoning, Critic, Creative, Coding, Research, Planning, Voice and Memory.

## Runtime
- Node.js 20+
- Optional Ollama local model provider
- Optional OpenAI-compatible provider
- Workspace-bounded file APIs
- Explicit developer token for write/command APIs
- Command allowlist: node, npm, git
- 15-second developer command timeout
- Request size and rate limits
- Audit log
- PWA/offline shell
- Browser speech recognition and speech synthesis

## Environment
`MODEL_PROVIDER=ollama|openai|none|auto`
`MODEL_NAME=qwen2.5:7b`
`MODEL_BASE_URL=http://localhost:11434`
`OPENAI_API_KEY=...`
`OPENAI_MODEL=gpt-5-mini`
`CRAZY_ADMIN_TOKEN=...`

Never commit secrets. Use Railway environment variables for production credentials.
