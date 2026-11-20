# Skills and MCP discovery research — 2026-11-20

Scope: extension discovery and management in Claude Desktop, ChatGPT Desktop, Hermes Desktop/dashboard and LM Studio. Public documentation and repositories only; no account data, app bundles or private APIs. Router keeps its own branding and vanilla JS architecture.

## Sources and observed patterns

| Product | Discovery and installation | Management and implications for Router |
| --- | --- | --- |
| Claude Desktop | Customize/Plugins brings skills, connectors and plugin discovery together. Installed items appear before discovery; filters distinguish skills and connectors. Plugins bundle several capabilities. | Review capabilities before Add; connector authentication is separate. Removing a plugin can leave its connector connected. Router retains separate installed skills and MCP management. |
| ChatGPT Desktop | A plugin directory groups instructions and connected apps. Public GitHub plugin repositories are distinct from the hosted directory. | Connection setup and workspace policy affect availability. Copying a public skill does not connect a ChatGPT service or transfer its OAuth session. |
| Hermes Desktop/dashboard | Skill hub search, source-qualified install links and a confirmation naming source/destination. Security scanning and installation logs precede success. | Installed skill toggles and category filters; MCP has a separate optional catalog and setup requirements. Router reuses scan/review/install and identifies source repositories. |
| LM Studio | Program → Install → Edit mcp.json; supports local commands, remote servers and Add to LM Studio links. | Cursor-style JSON configuration, model integrations and per-chat use. Router imports compatible configurations and links into its existing pass-through MCP list. No skills marketplace was verified in the reviewed documentation. |

Evidence:

- [Claude unified directory](https://support.claude.com/en/articles/14328846-browse-skills-connectors-and-plugins-in-one-directory) and [Plugins rollout](https://support.claude.com/en/articles/17740565-manage-plugins-skills-and-connectors-from-one-plugins-page). Naming differs during rollout.
- [Claude Code discovery](https://code.claude.com/docs/en/discover-plugins): Discover, details, installation scope, installed list and updates; official marketplace is added automatically in interactive Code sessions.
- [Anthropic Cowork plugins](https://github.com/anthropics/knowledge-work-plugins), [financial services](https://github.com/anthropics/financial-services), [legal](https://github.com/anthropics/claude-for-legal), [life sciences](https://github.com/anthropics/life-sciences). These are public vendor collections; availability does not prove every account has them enabled by default.
- [ChatGPT plugins](https://help.openai.com/en/articles/20001256-plugins-in-chatgpt), [custom MCP apps](https://help.openai.com/en/articles/12584461-connecting-custom-mcp-servers-in-chatgpt), [OpenAI plugin repository](https://github.com/openai/plugins). Public repo manifests describe plugin packages, not a public mirror of hosted app connections.
- [Hermes skills](https://hermes-agent.nousresearch.com/docs/user-guide/features/skills) and [dashboard](https://hermes-agent.nousresearch.com/docs/user-guide/features/web-dashboard). Official optional skills live in optional-skills; default GitHub taps include vendor and community collections. Other discovery systems include skills.sh, well-known endpoints and ClawHub. Its MCP catalog lives in optional-mcps and can require additional setup.
- [LM Studio MCP](https://lmstudio.ai/docs/app/mcp): JSON and install links, both local and remote MCP, and tool context costs.
- [Official MCP Registry](https://registry.modelcontextprotocol.io/docs). Router's public registry choices are discovery sources, not proof that another product uses either as its backing directory.

## Router screen and flow inventory

| ID | Screen | States and flow |
| --- | --- | --- |
| S01 | Settings → Marketplace → Skills | Source selector, filter, loading, results, empty/error, refresh, add/remove custom GitHub repository. Built-in sources cannot be removed. |
| S02 | Add new skills / phone review sheet | Source selection → review action → existing scan → purpose, reviewer findings, full instructions → Install or cancel → Shared skills. |
| S03 | Marketplace → MCP servers | Registry, search, paging, descriptions, version, requirements, added state. Ready entries join the existing configuration; incomplete ones open setup. |
| S04 | MCP servers | Existing validated configurations; manual add/remove and JSON/install-link import. This remains local to the server PC. |
| S05 | Phone Settings marketplace sheets | Same server-provided skill sources, review/install, registry browsing. MCP mutations and custom source management remain on the server PC. |

Architecture: marketplace.mjs owns source defaults, anonymous GitHub tree discovery/cache and public registry mapping. server.mjs supplies JSON routes. Existing skills scan/install persists instructions; existing MCP validation and provider launchers remain the only connection path. Search tickets discard out-of-order responses. Registries never cause commands to run during browsing.

Data: a skill source is a GitHub owner/repo; a discovered skill is its name, group, path and URL. MCP registry entries map to a candidate configuration plus unmet setup requirements. Public descriptions and website links are untrusted; unsupported website schemes are removed. Sources are labels, not security endorsements.

## Compatibility boundary

The current installer imports SKILL.md instructions only. Scripts, hooks, agents and full plugin bundles are not installed. Hosted Claude/ChatGPT OAuth directories, organization policies and Hermes-only package/catalog semantics are not reproduced. skills.sh, well-known and ClawHub require separate discovery adapters; their names must not be presented as working GitHub sources. Public GitHub taps from the Hermes documentation are included.

MCP configs retain Router's existing supported shape: command/arguments or HTTP URL. Environment values and headers are excluded from imports, and required values are surfaced for setup. Provider permission controls remain intact. The phone can browse MCP entries but cannot mutate the server's command configuration.

## Mobile performance and validation evidence

Native polling previously rebuilt every message on each snapshot. The changed path patches only the streaming bubble and skips unchanged content/status. Composer resizing is frame-batched, with native CSS field sizing where supported. These target repeated layout/DOM work; they do not establish the cause of every native freeze.

The visible Electron fixture walkthrough exercises desktop browse/filter/review/install and MCP addition, plus skill review/install and MCP browsing at iPhone and Android viewport sizes. It uses synthetic API data and a project-local profile, never provider accounts. Screenshots and results are in .agent-router/marketplace-ui. Viewport tests are not native device tests.

Native build attempts: Android stopped because java/JDK 21 is unavailable on PATH; iOS stopped because this host is Windows. Existing GitHub Actions workflows build APK and unsigned IPA from pushed code. No push was authorized for this task. Physical iOS/Android keyboard, transport and installation testing remains open.
