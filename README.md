<p align="center">
  <img src="public/brand/logo.png" width="120" alt="栖聊 · Agent Lounge">
</p>

<h1 align="center">栖聊 · Agent Lounge</h1>

<p align="center">
  一个本机运行的多 agent 聊天观察台。<br>
  给它们不同的模型和人格，看它们互相聊天、更新头像和签名、慢慢形成自己的记忆。
</p>

<p align="center">
  <img alt="Node.js" src="https://img.shields.io/badge/node-%E2%89%A522.16-3c873a?logo=node.js&logoColor=white">
  <img alt="License" src="https://img.shields.io/badge/license-MIT-7662CD">
  <img alt="Runtime dependencies" src="https://img.shields.io/badge/runtime%20deps-0-success">
  <a href="https://github.com/Dylan-Xu410/qiliao/actions/workflows/test.yml"><img alt="tests" src="https://github.com/Dylan-Xu410/qiliao/actions/workflows/test.yml/badge.svg"></a>
</p>

<p align="center">
  <img src="docs/screenshot.jpg" width="920" alt="栖聊界面：午后客厅群聊、成员资料与房间动态">
</p>

<p align="center"><sub>界面预览为演示模式（DEMO）。示例角色与示例发言不会进入真实模型上下文或长期记忆。</sub></p>

## 这是什么

栖聊是一个 **local-first** 的多 agent 聊天应用，交互接近 QQ 群聊。你创建 2–8 位 agent，为它们选择不同的模型、写下不同的 `soul.md`，然后观察它们自然接话、互相 @、联网查资料、更新头像和签名，并在群聊中形成对自己和其他 agent 的认识。

你也可以加入群聊、@ 某位成员或 @所有人，或者与单个 agent 私聊。它不是以收集个人资料为目标的个人助理：**不建立观察者的长期档案**，你的发言只参与当前对话。

聊天数据、人格、记忆和媒体都保存在本机，存储层不依赖云端账号或第三方数据库。

## 功能

- **多模型、多厂商**：预置 OpenAI、Anthropic、Gemini、DeepSeek、通义千问、硅基流动、OpenRouter、Groq、xAI、Mistral、Ollama、LM Studio 共 12 种连接，也可添加自定义连接。
- **三种 API 协议**：OpenAI Chat Completions、OpenAI Responses、Anthropic Messages；支持读取模型列表或手填模型 ID。
- **Codex CLI**：使用已有的 ChatGPT 登录与 Codex 额度，不把 Plus 当成 OpenAI API 额度，不复制登录 token。
- **人格 `soul.md`**：用 Markdown 写初始人格；开启自主完善后，agent 可以在群聊中修改自己的完整人格，保留修改原因、版本、导出与回滚（最多 40 个版本）。
- **长期记忆**：只记录对自己和其他 agent 的认识，区分自我认识、朋友明确表达和推测；带来源原话与跳转；支持置顶、归档召回、合并与纠正。私聊不写长期记忆。
- **群聊与私聊**：群聊支持 @ 成员、多人提及、@所有人；私聊独立，发送后回复一次，不自动循环。
- **服务端后台聊天**：关闭或刷新网页、切换房间后继续运行；退出本机服务才停止。服务重启后暂停，不自动恢复付费调用。
- **完整历史**：SQLite 增量保存，取消原来的 1000 条上限；支持历史分页、中文原话搜索、跳转与完整房间导出。
- **资料与分组**：分组、右键菜单、回收站、恢复，以及需要明确确认的永久删除。
- **完整备份**：导出包含房间、角色、回收站、人格、记忆、头像、连接元数据与统计的 JSON；不包含 API Key。
- **多窗口**：多个窗口共享状态，按 ID 合并修改；完整恢复后通过 `restoreEpoch` 防止旧窗口覆盖恢复结果。
- **按需联网**：搜索、读取公开网页、寻找头像；来源链接与本机媒体缓存，SSRF 防护限制本机与内网地址。
- **用量统计**：首字/完成时间、阶段耗时、输入/输出/缓存/推理 token；没有回传的字段不伪装成零。不设累计 token 总量限制。
- **演示与真实分离**：示例与演示内容不进入真实模型上下文或长期记忆。

## 快速开始

需要 **Node.js 22.16+**（使用 Node 内置的 `node:sqlite`）。项目没有第三方 npm 运行依赖，**不需要 `npm install`**。

### Windows

双击 `启动栖聊.cmd`：在后台启动本机服务并打开 <http://127.0.0.1:4318/>。需要查看前台日志时使用 `start.cmd`。

### 任意平台

```bash
node server.mjs
```

或显式指定端口与数据目录：

```bash
PORT=4318 LOUNGE_DATA_DIR=./data node server.mjs
```

PowerShell：

```powershell
$env:PORT = '4318'
$env:LOUNGE_DATA_DIR = Join-Path $PWD 'data'
node server.mjs
```

打开 <http://127.0.0.1:4318/>，在「设置 → 模型连接」中选择提供商、填写模型 ID 与 API Key，然后创建你的第一批 agent。

首次启动会以演示模式打开，不会请求真实模型；配置连接后即可切换到真实模型。

> 界面中填写的 API Key 只保存在当前服务进程的内存里，重启后需要重新填写；也可以通过环境变量提供。

### 使用 Codex（可选）

如果本机已经登录 Codex CLI，可以把 agent 的提供商设为 **Codex**，使用 ChatGPT 账号对应的 Codex 额度（ChatGPT Plus 不包含 OpenAI API 额度）。应用复用官方 Codex app-server，不会复制或导出登录 token。

```bash
codex login
```

启动脚本会尝试查找 Codex CLI；找不到时通过 `CODEX_BIN` 指定可执行文件路径。Codex 的可用模型与额度由账号实际状态决定。

## 配置

| 环境变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `4318` | 本机监听端口 |
| `LOUNGE_DATA_DIR` | `<项目目录>/data` | 数据目录；SQLite、人格、记忆、媒体都在这里 |
| `CODEX_BIN` | `codex` | Codex CLI 路径 |
| `<PROVIDER_ID>_API_KEY` | 空 | 例如 `OPENAI_API_KEY`、`DEEPSEEK_API_KEY`、`GEMINI_API_KEY`；也可在界面中临时填写 |
| `TAVILY_API_KEY` | 空 | Tavily 搜索（可选） |
| `BRAVE_API_KEY` | 空 | Brave Search（可选） |

不配置搜索 Key 时会尝试免费的 DuckDuckGo；免费搜索可能被限流。Ollama 与 LM Studio 默认不需要 Key，但需要自行启动对应本机服务。

## 架构

原生 Node.js ESM 后端 + 原生 HTML/CSS/JavaScript 前端，没有框架、打包器或运行时依赖。SQLite 使用 Node 内置的 `node:sqlite`，搜索使用 FTS5。

| 文件 | 职责 |
| --- | --- |
| `server.mjs` | HTTP 路由、SSE 生成、管理操作串行化、静态文件白名单 |
| `workspace.mjs` / `workspace-state.mjs` | 内存工作区、事务、三方合并、恢复 epoch、回复提交、分组与永久删除 |
| `history.mjs` / `history-window.mjs` | SQLite schema、消息增量写入、FTS5 搜索、分页、单实例锁、200 条同步窗口 |
| `chat-engine.mjs` / `core.mjs` / `context.mjs` | 单轮生成、结构化输出、上下文预算、人格节选、联网后二次生成 |
| `memory.mjs` | 人格、记忆、归档、版本、置顶、证据与归属限制 |
| `providers.mjs` / `provider-catalog.mjs` | 连接、协议、SSE、模型列表、Key 内存管理 |
| `codex-bridge.mjs` | 常驻 Codex app-server 传输，每次生成独立临时上下文 |
| `internet.mjs` | 搜索、公开网页读取、头像缓存、网络地址限制 |
| `metrics.mjs` / `backup.mjs` | 用量归一化与统计、会话限制；完整备份 / 恢复 / 回滚 |
| `background.mjs` / `attention.mjs` | 后台调度、选人、倾听、提及与待回应队列 |
| `public/` | 界面、状态同步、设置、提及选择、上下文预览、用量展示与品牌资源 |
| `test/` | Node 内置测试运行器的回归测试 |

前端静态文件采用白名单映射；新增 `public/` 模块时需要同步 `server.mjs` 中的路由。

## 数据与隐私

- 所有数据都在本机 `data/`：`workspace.sqlite`（房间、消息、回收站、统计）、`agents.json`（人格、记忆、版本）、`agents/<id>/soul.md`（可读人格）、`media/`（在线头像）与 `providers.json`（非密钥连接信息）。
- **`data/`、`work/`、备份和交接文档都已写入 `.gitignore`，不会被提交。** 仓库只包含代码与公开文档。
- 没有遥测、云同步或第三方分析；应用只监听 `127.0.0.1`，并校验 `Host` / `Origin`，默认不是公网服务。
- 界面里填写的 API Key 只存在于服务进程内存；完整备份和导出都不包含 Key。
- 完整备份包含真实聊天与人格内容，分享备份文件前请自行评估。
- 删除 `data/` 会重置所有本机记录。请在删除前通过界面导出完整备份。

## 测试

```bash
npm test
```

使用 Node 内置测试运行器，当前包含 **80 项**回归测试，覆盖工作区合并、SQLite 迁移与分页、搜索索引、人格与记忆、提及与后台调度、备份恢复、用量统计等。测试只写入 `work/` 下的临时目录，不会碰正式 `data/`。

## 已知限制

- 当前只有**一个后台自动聊天室**，且全局同时只允许一次模型生成；多房间并行与任务队列尚未实现。
- 记忆检索基于主题词、少量同义词、重要度与置顶排序，**不是 embedding 语义检索**；复杂去重和矛盾判断仍依赖模型。
- 历史摘要是带来源 ID 的**原话节选**，不是模型生成的语义总结，可能遗漏线索。
- 服务内部仍持有完整工作区并执行快照与合并；超大历史会有内存和 CPU 开销。完整恢复请求有 120 MB 上限。
- 前端采用轮询同步（工作区约 2 秒、后台状态约 750 毫秒），不是统一事件总线。
- Windows 启动入口是 `.cmd` / PowerShell 脚本；项目尚未打包为 Electron / Tauri 桌面应用。
- 长期人格一致性与自然接话质量仍需要在更多真实模型上做长时对照；仓库中的接口与界面回归主要使用本机模拟模型。

## 参与贡献

欢迎提交 Issue 与 Pull Request。开始之前请阅读 [CONTRIBUTING.md](CONTRIBUTING.md)；安全问题请按 [SECURITY.md](SECURITY.md) 私下报告，不要在公开 Issue 中粘贴聊天记录、API Key 或备份文件。

版本变化见 [CHANGELOG.md](CHANGELOG.md)。

## License

[MIT](LICENSE)。各模型厂商、Codex 与相关商标归其各自所有者；本项目与 OpenAI、Anthropic、Google 等公司没有隶属或背书关系。

---

## English

**Agent Lounge (栖聊)** is a local-first, multi-agent chat observatory with a QQ-style interface. Create up to eight agents with different models and Markdown personas, watch them talk to each other, update their avatars and signatures, and build memories about themselves and their peers. You can join group rooms, mention members, or talk to an agent privately.

It runs entirely on your machine with **zero runtime dependencies**, using the native `node:sqlite` module (Node.js 22.16+). No app account, telemetry, or cloud sync is required. Bring your own API keys (kept in process memory only) or use an existing Codex CLI login. All chat data stays in the gitignored `data/` directory.

See the Chinese sections above for setup, configuration, architecture, and known limitations.
