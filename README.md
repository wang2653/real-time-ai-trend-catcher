# Real-Time AI Trend Catcher

## Project Introduction
Real-Time AI Trend Catcher is an automated, multi-agent system designed to fetch, curate, analyze, and summarize information from diverse data sources (e.g., HackerNews, DevTo, Web). It streamlines the entire workflow from raw data ingestion to a finalized Markdown report that can be exported as a PDF. By leveraging Server-Sent Events (SSE), the platform provides real-time visualization of the AI agents' execution processes, offering users rapid, high-quality, and transparent industry insights.

## Core Features
- **Multi-Agent Orchestration**: Coordinates specialized roles including a Curator (for data filtering), an Analyst (for deep trend analysis), a Summarizer (for concise abstractions), and a Writer (for final report generation) in a pipeline architecture.
- **Dynamic Data Curation & Aggregation**: Concurrently pulls data from multiple sources, utilizing AI for semantic deduplication and value scoring.
- **Real-Time Visualized Workflow**: Utilizes SSE to stream intermediate processing states to the frontend, eliminating the "black box" wait time and showcasing the actual agent thought processes.
- **State & Memory Management**: Implements both short-term and long-term memory via a Memory Store. It manages persistence with specific conversation IDs to strictly isolate and maintain historical items and reports, ensuring context continuity.
- **Seamless Export**: Renders the AI-generated Markdown into a well-formatted PDF report instantly.

## System Architecture

```text
[Data Sources] (HackerNews, DevTo, Web) 
      │
      ▼
[Ingestion & Merge] --> [Memory Store (History/Context)]
      │
      ▼
[Agent Pipeline Orchestration]
  ├─ 1. Curator Agent (Semantic Filtering & Deduplication)
  ├─ 2. Analyst Agent (Trend Extraction & Clustering)
  ├─ 3. Summarizer Agent (Content Condensation)
  └─ 4. Writer Agent (Markdown Report Generation)
      │
      ▼
[Server-Sent Events (SSE) Stream]
      │
      ▼
[React Frontend] (Real-time state visualization, multi-source filtering)
      │
      ▼
[Markdown Rendering & PDF Export]
```

## Technology Stack
- **AI/LLM Framework**: `@openai/agents`, `openai`, `zod` (for structured output validation)
- **Frontend**: React 18, Vite, CSS Modules
- **Backend/Edge**: Node.js, Server-Sent Events (SSE)
- **Utilities**: `html2pdf.js` for PDF generation

## Quick Start

1. **Clone the repository and install dependencies**:
   ```bash
   npm install
   ```

2. **Environment Configuration**:
   Copy `.env.example` to `.env` and fill in your LLM credentials:
   ```env
   LLM_API_KEY=your_api_key_here
   LLM_BASE_URL=your_api_base_url
   LLM_MODEL=your_preferred_model
   ```

3. **Run the Development Server**:
   ```bash
   npm run dev
   ```

4. **Build for Production**:
   ```bash
   npm run build
   ```

## Advanced Engineering Practices (For Technical Reviewers)
This repository demonstrates several advanced engineering practices crucial for production-grade AI Agent development:

- **Robust LLM Output Parsing & Error Recovery**: 
  The codebase features a highly resilient JSON parser (`parseJsonFromText`) designed to handle malformed LLM outputs. It automatically fixes trailing commas, balances truncated brackets, and accurately extracts JSON structures embedded within Markdown code fences or conversational preamble.
- **Prompt Injection & Artifact Defense**:
  Implemented dynamic sanitization (e.g., `stripThinkingTags`) to proactively strip out internal reasoning artifacts (like `<think>` tags emitted by models like DeepSeek), ensuring that intermediate LLM thought processes do not leak into user-facing data payloads or break the JSON schema.
- **High-Performance Streaming Architecture**:
  Replaces traditional request-response polling with a robust Server-Sent Events (SSE) pipeline (`ReadableStream` with `controller.enqueue`). The system emits granular, phase-based updates (e.g., `phase: 'fetched'`, `phase: 'curated'`) to the frontend, which handles progressive rendering gracefully.
- **Graceful Degradation & Fault Tolerance**:
  Built-in `AbortSignal` handling and fallback mechanisms (`generateFallbackReport`) guarantee that if an external LLM provider times out or the user cancels the request, the system degrades gracefully without crashing, maintaining a high level of system availability.