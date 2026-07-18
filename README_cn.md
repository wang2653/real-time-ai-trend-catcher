# Real-Time AI Trend Catcher

## 项目简介
本项目是一个自动化的多智能体（Multi-Agent）系统，实现了从多数据源拉取数据、智能筛选策展、趋势分析到最终 Markdown 报告渲染及 PDF 导出的全自动化工作流。系统采用 Server-Sent Events (SSE) 流式传输技术，在前端具象化展示智能体的运行状态与耗时，旨在为用户提供快速、高质量且透明的行业趋势洞察，体现了 AI Agent 赋能信息检索与内容生产的商业价值。

## 核心特性
- **多智能体协同与编排**：系统化编排了 Curator（内容策展）、Analyst（深度分析）、Summarizer（摘要提炼）与 Writer（报告撰写）等专业角色，形成流水线式的 Agent 工作流。
- **多源数据融合与动态筛选**：支持跨越多个技术社区进行并发数据拉取，利用 LLM 进行语义去重与信息价值评分。
- **流式实时可视化**：摒弃传统的黑盒等待，基于 SSE 将 Agent 的中间态数据实时推送到前端，UI 端支持按数据源筛选并具象化展示处理流程的时间线。
- **记忆机制（Memory Store）**：实现了基于 Conversation ID 的状态与记忆管理机制，精细化隔离历史抓取记录（items）与历史分析报告（reports），确保 Agent 具备长期上下文感知与追溯能力。
- **渲染与一键导出**：将 AI 生成的 Markdown 报告无缝渲染为排版精良的视图，并支持高质量导出为 PDF。

## 系统架构

```text
[多数据源] (HackerNews, DevTo, Web) 
      │
      ▼
[数据拉取与聚合] --> [记忆存储 Memory Store (上下文与历史)]
      │
      ▼
[Agent 编排流水线 Pipeline]
  ├─ 1. Curator Agent (语义过滤与去重)
  ├─ 2. Analyst Agent (趋势提取与聚类)
  ├─ 3. Summarizer Agent (内容提炼)
  └─ 4. Writer Agent (Markdown 报告生成)
      │
      ▼
[Server-Sent Events (SSE) 流式分发]
      │
      ▼
[React 前端应用] (多数据源筛选、运行态势可视化展示)
      │
      ▼
[Markdown 报告渲染及 PDF 导出]
```

## 技术栈
- **AI 与智能体框架**：`@openai/agents`, `openai`, `zod` (用于结构化输出校验)
- **前端页面**：React 18, Vite, CSS Modules
- **后端与网关**：Node.js, Server-Sent Events (SSE) 流式响应
- **工具链**：`html2pdf.js`

## 快速开始

1. **克隆项目并安装依赖**：
   ```bash
   npm install
   ```

2. **环境变量配置**：
   复制 `.env.example` 为 `.env` 文件，并填入相应的 LLM API 密钥与地址：
   ```env
   LLM_API_KEY=your_api_key_here
   LLM_BASE_URL=your_api_base_url
   LLM_MODEL=your_preferred_model
   ```

3. **启动开发服务器**：
   ```bash
   npm run dev
   ```

4. **构建生产版本**：
   ```bash
   npm run build
   ```

## 工程实践
作为体现 AI Agent 开发深度的项目，本代码库包含以下关键的工程化实践：

- **高可用 LLM 输出解析与容错重试（Robust JSON Parsing）**：
  为应对大模型输出格式的不稳定性，系统内置了高度弹性的 `parseJsonFromText` 解析器。它能够自动修复尾部逗号、自动补全截断的 JSON 括号，并支持从 Markdown 代码块甚至包含前置闲聊的文本中精准提取 JSON 结构，极大提高了流水线的稳定性。
- **Prompt 注入与脏数据防御**：
  对于部分模型（如 DeepSeek）倾向于在输出中携带 `<think>...</think>` 等思考过程标签的问题，代码中实现了动态正则清洗（`stripThinkingTags`），防止此类中间态数据污染最终对用户的输出或破坏结构化解析。
- **高并发流式处理架构（SSE Streaming）**：
  服务端采用 `ReadableStream` 结合 `controller.enqueue` 替代了传统的长轮询，将 Pipeline 的各个阶段（如 fetched, curated 等）切片并实时下发。前端能够据此实现“渐进式”渲染，为长耗时的 Agent 任务提供了出色的用户体验。
- **优雅降级与状态管理（Graceful Degradation）**：
  集成了 `AbortSignal` 中断机制与 `generateFallbackReport` 兜底生成逻辑。在外部 LLM 服务超时或用户主动中断时，系统不会崩溃，而是返回具备基础信息的兜底报告，保障了核心业务的可用性。