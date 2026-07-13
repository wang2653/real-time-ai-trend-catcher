// import external dependencies for agents and data parsing
import { Agent, OpenAIChatCompletionsModel, run, tool } from '@openai/agents';
import { OpenAI } from 'openai';
import { z } from 'zod';

// import local types and helper functions for pipeline
import type { TrendLibraryItem } from './_item_library.js';
import { generateFallbackReport, utcNow } from './_report_helpers.js';
import type {
  CuratorOutput,
  FinishedReport,
  SummarizerOutput,
  TrendAnalysis,
  TrendGroup,
  TrendReport,
  TrendSourceItem,
} from './_pipeline_types.js';

// import specific schemas for tool parameters
import {
  ComparePeriodsParamsSchema,
  GetHistoryItemsParamsSchema,
} from './_pipeline_types.js';

// import prompt templates and builders for agents
import {
  ANALYST_INSTRUCTIONS,
  CURATOR_INSTRUCTIONS,
  SUMMARIZER_INSTRUCTIONS,
  WRITER_INSTRUCTIONS,
  buildAnalystPrompt,
  buildItemsJson,
  buildWriterPrompt,
} from './_prompts.js';

const CONFIG = {
  // OpenAI Client
  OPENAI_TIMEOUT_MS: 600000,
  // model name
  DEFAULT_MODEL_NAME: '@makers/minimax-m2.7',

  // sandbox fetch
  FETCH_MAX_TIME_SEC: 10,
  FETCH_MAX_CHARS: 3000,

  // history items
  HISTORY_DEFAULT_MAX_ITEMS: 50,
  HISTORY_DEFAULT_DAYS_BACK: 7,

  // prompts limits
  PROMPT_MAX_ITEMS: 30,

  // report generation
  REPORT_GROUP_SUMMARY_ITEMS: 3,
  REPORT_GROUP_MAX_ITEMS: 5,
  REPORT_SUMMARY_MAX_CHARS: 120,

  // agent execution
  AGENT_STREAM_PROGRESS_INTERVAL_MS: 8000,
};

// ── OpenAI client setup (via AI Gateway) ──────────────────────────

// build configuration options for openai client
// fallbacks to different environment variables if missing
export function buildOpenAIClientOptions(env: Record<string, string | undefined>) {
  return {
    apiKey: env.LLM_API_KEY || env.AI_GATEWAY_API_KEY || env.OPENAI_API_KEY,
    baseURL: env.LLM_BASE_URL || env.AI_GATEWAY_BASE_URL || env.OPENAI_BASE_URL,
    timeout: CONFIG.OPENAI_TIMEOUT_MS,
  };
}

// instantiate openai model object with resolved model name
function createModel(env: Record<string, string | undefined>): OpenAIChatCompletionsModel {
  const client = new OpenAI(buildOpenAIClientOptions(env));
  const modelName = env.LLM_MODEL || env.AI_GATEWAY_MODEL || CONFIG.DEFAULT_MODEL_NAME;
  return new OpenAIChatCompletionsModel(client as any, modelName);
}

// ── JSON parsing helpers ──────────────────────────────────────────

/**
 * Strip <think>...</think> reasoning tags that some models (DeepSeek, etc.)
 * emit in their output. These should never appear in final user-facing content.
 * Handles multiline content and multiple occurrences.
 */
// remove <think> tags using regular expression
function stripThinkingTags(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}

// parse raw text into a generic json object
function parseJsonFromText<T>(text: string): T | null {
  // Strip thinking tags first — some models prepend <think>...</think> before JSON
  const cleaned = stripThinkingTags(text);

  // Helper: fix common JSON issues (trailing commas, etc.)
  // inner function to attempt json parsing and minor string fixes
  function tryParse(json: string): T | null {
    // Direct attempt
    try { return JSON.parse(json) as T; } catch { /* continue */ }
    // Fix trailing commas: ,] or ,}
    const fixed = json
      .replace(/,\s*([}\]])/g, '$1')
      .replace(/,\s*$/g, '');
    try { return JSON.parse(fixed) as T; } catch { /* continue */ }
    // Try to fix truncated JSON by closing brackets
    // count open and close brackets to balance them automatically
    let attempt = fixed;
    const opens = (attempt.match(/[{[]/g) || []).length;
    const closes = (attempt.match(/[}\]]/g) || []).length;
    for (let i = 0; i < opens - closes; i++) {
      // Determine which bracket to close
      const lastOpen = Math.max(attempt.lastIndexOf('{'), attempt.lastIndexOf('['));
      attempt += attempt[lastOpen] === '{' ? '}' : ']';
    }
    // final parse attempt on balanced json
    try { return JSON.parse(attempt) as T; } catch { /* continue */ }
    return null;
  }

  // Try direct parse
  // attempt to parse the cleaned text directly
  const direct = tryParse(cleaned);
  if (direct) return direct;

  // Try extracting JSON block from markdown code fence
  // match markdown code block syntax if direct parse fails
  const fenceMatch = cleaned.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fenceMatch) {
    const result = tryParse(fenceMatch[1]);
    if (result) return result;
  }
  // Try extracting first { ... } or [ ... ]
  // match object structure within text
  const objMatch = cleaned.match(/\{[\s\S]*\}/);
  if (objMatch) {
    const result = tryParse(objMatch[0]);
    if (result) return result;
  }
  // match array structure within text
  const arrMatch = cleaned.match(/\[[\s\S]*\]/);
  if (arrMatch) {
    const result = tryParse(arrMatch[0]);
    if (result) return result;
  }
  // Last resort: find the first { and try to parse from there (handles preamble text)
  // slice string from first open brace
  const firstBrace = cleaned.indexOf('{');
  if (firstBrace > 0) {
    const result = tryParse(cleaned.slice(firstBrace));
    if (result) return result;
  }
  // log warning when all parsing attempts fail
  console.warn('[parseJson] all attempts failed, first 200 chars:', cleaned.slice(0, 200));
  return null;
}

// ── Tool definitions ──────────────────────────────────────────────

/**
 * Create a sandbox-powered fetch tool for Agents (用法 A).
 * Uses context.sandbox.commands.run('curl ...') to fetch URL content.
 * Compatible with ChatCompletions API via @openai/agents tool().
 */
// setup fetch tool that uses sandbox command runner
function createSandboxFetchTool(sandbox: any) {
  return tool({
    name: 'fetch_url',
    description: `Fetch webpage content from a specified URL using a sandbox curl command (first ${CONFIG.FETCH_MAX_CHARS} characters). Use this tool when you need to understand the detailed content of an article to aid in trend analysis.`,
    // define schema for url parameter
    parameters: z.object({
      url: z.string().min(1).describe('要获取内容的完整 URL'),
    }),
    // execute curl command in sandbox and return truncated output
    execute: async (input: { url: string }) => {
      console.log(`[fetch_url] Agent called fetch_url: ${input.url}`);
      try {
        const result = await sandbox.commands.run(
          `curl -sL --max-time ${CONFIG.FETCH_MAX_TIME_SEC} '${input.url.replace(/'/g, "'\\''")}' | head -c ${CONFIG.FETCH_MAX_CHARS}`,
        );
        // check if curl command failed and return error json
        if (result?.exitCode && result.exitCode !== 0) {
          console.warn(`[fetch_url] curl failed: exit=${result.exitCode}`);
          return JSON.stringify({ error: `curl failed: ${result.stderr || 'unknown error'}` });
        }
        // return successful output or empty fallback
        console.log(`[fetch_url] success, ${(result?.stdout || '').length} chars`);
        return result?.stdout || '(empty response)';
      } catch (err: any) {
        // catch exception during execution and return error json
        console.warn(`[fetch_url] error:`, err?.message);
        return JSON.stringify({ error: err?.message || 'fetch failed' });
      }
    },
  });
}

// setup get history items tool for past data retrieval
function createGetHistoryItemsTool(historyItems: TrendLibraryItem[]) {
  return tool({
    name: 'get_history_items',
    description: 'Retrieve historical AI news items for comparing current and past trend data. Returns historical items within a specified time range.',
    parameters: GetHistoryItemsParamsSchema,
    // fetch items from history based on cutoff date
    execute: async (input: { maxItems?: number; daysBack?: number }) => {
      const maxItems = input.maxItems ?? CONFIG.HISTORY_DEFAULT_MAX_ITEMS;
      const daysBack = input.daysBack ?? CONFIG.HISTORY_DEFAULT_DAYS_BACK;
      const cutoff = new Date(Date.now() - daysBack * 86400000).toISOString();
      // filter history items older than cutoff
      const filtered = historyItems
        .filter(item => (item.lastSeenAt || item.firstSeenAt || '') >= cutoff)
        .slice(0, maxItems);
      // return formatted json array of past items
      return JSON.stringify({
        count: filtered.length,
        items: filtered.map(item => ({
          id: item.id, title: item.title, category: item.category,
          source: item.source, seenCount: item.seenCount,
          firstSeenAt: item.firstSeenAt, lastSeenAt: item.lastSeenAt,
          isNew: item.isNew,
        })),
      });
    },
  });
}

// setup comparison tool for analyzing trend data changes
function createComparePeriodsTool(
  currentItems: TrendSourceItem[],
  historyItems: TrendLibraryItem[],
) {
  return tool({
    name: 'compare_periods',
    description: 'Compare the trend data differences between the current period and the previous period, analyzing by a specified metric (count/categories/sources).',
    parameters: ComparePeriodsParamsSchema,
    // split current and previous items into two sets
    execute: async (input: { currentItemIds: string[]; metric: 'count' | 'categories' | 'sources' }) => {
      const currentSet = new Set(input.currentItemIds);
      const current = currentItems.filter(i => currentSet.has(i.id));
      const previous = historyItems.filter(i => !currentSet.has(i.id));

      // helper to tally items by specific property key
      const countBy = (items: TrendSourceItem[], key: 'category' | 'source') => {
        const map: Record<string, number> = {};
        for (const i of items) {
          const k = (key === 'category' ? i.category : i.source) || 'Other';
          map[k] = (map[k] || 0) + 1;
        }
        return map;
      };

      // return comparison of total counts
      if (input.metric === 'count') {
        return JSON.stringify({ currentCount: current.length, previousCount: previous.length, delta: current.length - previous.length });
      }
      // return comparison of category distributions
      if (input.metric === 'categories') {
        return JSON.stringify({ current: countBy(current, 'category'), previous: countBy(previous, 'category') });
      }
      // fallback to return source distributions
      return JSON.stringify({ current: countBy(current, 'source'), previous: countBy(previous, 'source') });
    },
  });
}

// ── Agent factory functions (no outputType — prompt-guided JSON) ──

// create agent responsible for data curation and filtering
function createCuratorAgent(env: Record<string, string | undefined>) {
  return new Agent({
    name: 'CuratorAgent',
    instructions: CURATOR_INSTRUCTIONS,
    model: createModel(env),
  });
}

// create agent responsible for text summarization
function createSummarizerAgent(env: Record<string, string | undefined>) {
  return new Agent({
    name: 'SummarizerAgent',
    instructions: SUMMARIZER_INSTRUCTIONS,
    model: createModel(env),
  });
}

// create agent for analysis logic with multiple injected tools
function createAnalystAgent(
  env: Record<string, string | undefined>,
  currentItems: TrendSourceItem[],
  historyItems: TrendLibraryItem[],
  sandbox?: unknown,
) {
  // attach standard internal data query tools
  const tools: any[] = [
    createGetHistoryItemsTool(historyItems),
    createComparePeriodsTool(currentItems, historyItems),
  ];
  // Inject sandbox fetch tool if sandbox is available (用法 A: Agent 自主调用沙箱)
  // add web fetching capabilities if sandbox context exists
  if (sandbox && typeof (sandbox as any)?.commands?.run === 'function') {
    tools.push(createSandboxFetchTool(sandbox));
  }
  // build analysis agent object
  return new Agent({
    name: 'AnalystAgent',
    instructions: ANALYST_INSTRUCTIONS,
    model: createModel(env),
    tools,
  });
}

// create final agent for writing formatted markdown report
function createWriterAgent(env: Record<string, string | undefined>) {
  return new Agent({
    name: 'WriterAgent',
    instructions: WRITER_INSTRUCTIONS,
    model: createModel(env),
  });
}

// ── Report assembly helpers ───────────────────────────────────────

// organize items by their category property
function buildTrendGroups(items: TrendSourceItem[]): TrendGroup[] {
  const grouped = new Map<string, TrendSourceItem[]>();
  for (const item of items) {
    const category = item.category || 'AI Industry';
    grouped.set(category, [...(grouped.get(category) || []), item]);
  }
  // map grouped items into formatted trend array structures
  return Array.from(grouped.entries()).map(([category, catItems]) => ({
    category,
    summary: catItems.slice(0, CONFIG.REPORT_GROUP_SUMMARY_ITEMS).map(i => i.title).join('；'),
    count: catItems.length,
    items: catItems.slice(0, CONFIG.REPORT_GROUP_MAX_ITEMS),
  }));
}

// form standard report object from raw markdown text
function assembleReportFromWriter(items: TrendSourceItem[], markdown: string, runId: string, trigger: string): TrendReport {
  // extract the first readable line to use as summary
  const firstLine = markdown.split('\n').find(l => l.trim() && !l.startsWith('#'))?.trim() || '';
  const summary = firstLine.slice(0, CONFIG.REPORT_SUMMARY_MAX_CHARS) || `${items.length} 条 AI 资讯趋势分析`;
  // return fully shaped trend report
  return {
    runId,
    status: 'success',
    trigger,
    generatedAt: utcNow(),
    itemCount: items.length,
    summary,
    reportMarkdown: markdown,
    trends: buildTrendGroups(items),
    items,
  };
}

// build report from json analysis output if markdown writing fails
function assembleReportFromAnalysis(items: TrendSourceItem[], analysis: TrendAnalysis, runId: string, trigger: string): TrendReport {
  const lines = ['# AI 趋势日报', '', `> ${analysis.keyInsight}`, ''];

  // Group by category from analyst output
  // append grouped category sections to text content
  if (analysis.categories?.length) {
    lines.push('## 热门动态', '');
    for (const cat of analysis.categories) {
      lines.push(`### ${cat.name}`, '');
      // lookup original item data to form markdown links
      for (const entry of cat.items) {
        const item = items.find(i => i.id === entry.id);
        if (item) {
          lines.push(`- [${item.title}](${item.url}) — ${item.aiSummary || item.summary || entry.status}`);
        }
      }
      lines.push('');
    }
  }

  // Deep dives
  // append detailed analyses to text content
  if (analysis.deepDives?.length) {
    lines.push('## 深度分析', '');
    for (const dd of analysis.deepDives) {
      const item = items.find(i => i.id === dd.id);
      const url = item?.url || '';
      lines.push(`- [${dd.title}](${url}) — ${dd.insight}`);
    }
    lines.push('');
  }

  // inject built content into fallback shape
  const report = generateFallbackReport(items, runId, trigger);
  report.reportMarkdown = lines.join('\n');
  report.summary = analysis.keyInsight;
  report.agentWarning = 'Writer agent failed; report generated from analyst output';
  return report;
}

// ── Pipeline ──────────────────────────────────────────────────────

// define types for pipeline execution status
export type PipelineStage = 'fetch' | 'curator' | 'summarizer' | 'analyst' | 'writer' | 'complete' | 'error';
export type PipelineStatus = 'running' | 'done' | 'failed' | 'skipped';

// define payload schema for state change events
export interface PipelineEvent {
  stage: PipelineStage;
  status: PipelineStatus;
  duration?: number;
  detail?: string;
}

/**
 * Generic SSE payload — either the legacy bare-shape stage event or a typed
 * StreamEvent (`{ type: 'stage' | 'items' | 'analysis' | 'token' | ... }`).
 * The handler is responsible for serializing this to a `data:` SSE frame.
 */
// type alias handling multiple possible payload variants
export type PipelineEmit = PipelineEvent | { type: string; [key: string]: unknown };

// main input configuration passed to the execution runner
export interface PipelineInput {
  items: TrendSourceItem[];
  historyItems: TrendLibraryItem[];
  runId: string;
  trigger: string;
  env: Record<string, string | undefined>;
  noNewItems?: boolean;
  onProgress?: (event: PipelineEmit) => void;
  /** Sandbox instance (context.sandbox) — used to create sandbox tools for Agent */
  sandbox?: unknown;
  /** AbortSignal from the platform — when triggered, pipeline should stop ASAP */
  signal?: AbortSignal;
}

// collector interface for intermediate results
export interface PipelineStageResult {
  curatorOutput?: CuratorOutput;
  summarizerOutput?: SummarizerOutput;
  analystOutput?: TrendAnalysis;
  writerMarkdown?: string;
  failedStage?: string;
  error?: string;
}

/**
 * Run an agent in streaming mode, emitting `progress` events every few seconds
 * to keep the SSE connection alive (avoids CDN idle-timeout, typically 60s).
 *
 * If the stream fails with a transient error ("terminated", socket closed, etc.),
 * automatically retries once with a non-streaming call so the pipeline isn't
 * blocked by intermittent AI Gateway connection resets.
 *
 * The caller gets the same result shape as non-streaming `run()`.
 */
// function to execute agent with stream handling and periodic heartbeats
async function streamWithProgress(
  agent: Agent<unknown>,
  prompt: string,
  stage: string,
  emit: (event: PipelineEmit) => void,
  intervalMs = CONFIG.AGENT_STREAM_PROGRESS_INTERVAL_MS,
  signal?: AbortSignal,
): Promise<{ finalOutput: string }> {
  try {
    // block execution if request has already been cancelled
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

    // reset internal state tracking for new stream
    let accumulated = '';
    let tokenCount = 0;
    let lastEmitAt = Date.now();

    // trigger streaming llm request
    const result = await run(agent, prompt, { stream: true, signal });

    // process incoming tokens asynchronously
    for await (const event of result.toStream() as AsyncIterable<unknown>) {
      if (signal?.aborted) break;
      const ev = event as { type?: string; data?: { type?: string; delta?: unknown } };
      // check for text chunk event and update buffer
      if (ev.type === 'raw_model_stream_event' && ev.data?.type === 'output_text_delta') {
        const delta = String(ev.data.delta || '');
        if (delta) {
          accumulated += delta;
          tokenCount++;
          // Emit progress periodically to keep the SSE alive and show activity.
          // send heartbeat if interval threshold passed
          if (Date.now() - lastEmitAt >= intervalMs) {
            emit({ type: 'progress', stage, tokenCount, chars: accumulated.length });
            lastEmitAt = Date.now();
          }
        }
      }
    }

    // SDK's finalOutput is preferred (it strips internal framing if any).
    // favor sdk final value over accumulated chunks
    const finalOutput = (result as { finalOutput?: string }).finalOutput;
    const raw = typeof finalOutput === 'string' ? finalOutput : accumulated;
    return { finalOutput: stripThinkingTags(raw) };
  } catch (streamError) {
    // If aborted, rethrow immediately — don't retry
    // prevent retry if failure was due to user cancellation
    if (signal?.aborted || (streamError instanceof Error && streamError.name === 'AbortError')) {
      throw streamError;
    }
    // Transient failures (AI Gateway connection reset, "terminated", socket closed)
    // → retry once without streaming. The pipeline keeps going.
    // print warning and trigger secondary non-streaming attempt
    const msg = streamError instanceof Error ? streamError.message : String(streamError);
    console.warn(`[pipeline] ${stage} stream failed (${msg}), retrying without stream`);
    console.warn(`[pipeline] ${stage} full error:`, streamError);
    // run without stream and strip out think tags before returning
    const retryResult = await run(agent, prompt, { signal });
    return { finalOutput: stripThinkingTags(String(retryResult.finalOutput || '')) };
  }
}

// orchestrates multiple agents chronologically for the final document
export async function runAgentPipeline(input: PipelineInput): Promise<{
  report: TrendReport;
  stages: PipelineStageResult;
}> {
  // deconstruct parameters and set up empty tracking objects
  const { items, historyItems, runId, trigger, env, noNewItems, onProgress, sandbox, signal } = input;
  const stages: PipelineStageResult = {};
  const emit = onProgress ?? (() => {});

  // ── Stage 1+2: Curator & Summarizer (parallel) ─────────────────
  // initialize state with full lists prior to agent logic
  let curatedItems: TrendSourceItem[] = items;
  let enrichedItems: TrendSourceItem[] = items;

  try {
    // measure parallel execution time and push begin statuses
    const t0 = Date.now();
    console.log('[pipeline] Stage 1+2 (Curator+Summarizer) start');
    emit({ stage: 'curator', status: 'running' });
    emit({ stage: 'summarizer', status: 'running' });
    // instantiate level 1 agents and shape prompts
    const curatorAgent = createCuratorAgent(env);
    const summarizerAgent = createSummarizerAgent(env);
    const itemsJson = buildItemsJson(items, CONFIG.PROMPT_MAX_ITEMS);

    // execute curator and summarizer concurrently
    const [curatorResult, summarizerResult] = await Promise.allSettled([
      streamWithProgress(curatorAgent, `请策展以下候选内容：\n${itemsJson}`, 'curator', emit, CONFIG.AGENT_STREAM_PROGRESS_INTERVAL_MS, signal),
      streamWithProgress(summarizerAgent, `请为以下资讯生成中文摘要：\n${itemsJson}`, 'summarizer', emit, CONFIG.AGENT_STREAM_PROGRESS_INTERVAL_MS, signal),
    ]);
    // log resolution timing of concurrent calls
    console.log(`[pipeline] Stage 1+2 done (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    const stage12Duration = (Date.now() - t0) / 1000;

    // Process Curator
    // resolve text from successful curator promise
    if (curatorResult.status === 'fulfilled') {
      const raw = String(curatorResult.value.finalOutput || '');
      const parsed = parseJsonFromText<CuratorOutput>(raw);
      // apply parsed array to filter list
      if (parsed?.items?.length) {
        stages.curatorOutput = parsed;
        const keepIds = new Set(parsed.items.filter(i => i.keep).map(i => i.id));
        const curatorMap = new Map(parsed.items.map(i => [i.id, i]));
        // re-shape initial item array by dropping omitted entries
        curatedItems = items
          .filter(item => keepIds.has(item.id))
          .map(item => {
            const curated = curatorMap.get(item.id);
            return curated ? { ...item, category: curated.category } : item;
          });
        // fallback in case of catastrophic parsing failure
        if (!curatedItems.length) curatedItems = items;
        const detail = `kept ${curatedItems.length}/${items.length}`;
        console.log(`[pipeline] Curator: ${detail}`);
        // Log dropped items with reasons
        // log specific explicitly ignored items
        const dropped = parsed.items.filter(i => !i.keep);
        if (dropped.length) {
          console.log(`[pipeline] Curator dropped (explicit):`, dropped.map(i => `${i.id}: ${i.reason}`).join(' | '));
        }
        // Log items omitted entirely by curator (not mentioned in output)
        // figure out items implicitly removed by agent
        const mentionedIds = new Set(parsed.items.map(i => i.id));
        const omitted = items.filter(i => !mentionedIds.has(i.id));
        // log items that vanished from the output completely
        if (omitted.length) {
          console.log(`[pipeline] Curator omitted ${omitted.length} items (not in output):`, omitted.map(i => `[${i.source}] ${i.title?.slice(0, 30)}`).join(' | '));
        }
        // announce completion via emitter
        emit({ stage: 'curator', status: 'done', duration: stage12Duration, detail });
        // Phase 2 of progressive content: emit kept items so frontend can
        // fade out the dropped ones. We send only the items that survived
        // curation; frontend computes droppedIds = previousIds − newIds.
        // broadcast intermediate items payload
        emit({ type: 'items', phase: 'curated', items: curatedItems });
      } else {
        // notify about badly formatted response
        console.log('[pipeline] Curator: output parse failed, using all items');
        emit({ stage: 'curator', status: 'failed', duration: stage12Duration, detail: 'parse failed' });
      }
    } else {
      // notify about network level error
      console.log('[pipeline] Curator failed:', curatorResult.reason);
      emit({ stage: 'curator', status: 'failed', duration: stage12Duration, detail: 'agent error' });
    }

    // Process Summarizer
    // resolve text from successful summarizer promise
    if (summarizerResult.status === 'fulfilled') {
      const raw = String(summarizerResult.value.finalOutput || '');
      const parsed = parseJsonFromText<SummarizerOutput>(raw);
      // apply parsed text blocks to objects
      if (parsed?.items?.length) {
        stages.summarizerOutput = parsed;
        const summaryMap = new Map(
          parsed.items.filter(i => i.id && i.aiSummary).map(i => [i.id, i.aiSummary]),
        );
        // graft new data elements into item shapes
        enrichedItems = curatedItems.map(item => ({
          ...item,
          aiSummary: summaryMap.get(item.id) || item.aiSummary,
        }));
        // log output string size for reference
        const detail = `${summaryMap.size} summaries`;
        console.log(`[pipeline] Summarizer: ${detail}`);
        emit({ stage: 'summarizer', status: 'done', duration: stage12Duration, detail });
        // Phase 3 of progressive content: emit items with aiSummary filled in.
        // Frontend merges by id and fades the summary text in.
        // broadcast full items payload containing summaries
        emit({ type: 'items', phase: 'summarized', items: enrichedItems });
      } else {
        // notify about badly formatted summarizer response
        enrichedItems = curatedItems;
        console.log('[pipeline] Summarizer: output parse failed, no summaries');
        emit({ stage: 'summarizer', status: 'failed', duration: stage12Duration, detail: 'parse failed' });
      }
    } else {
      // notify about summarizer network level error
      enrichedItems = curatedItems;
      console.log('[pipeline] Summarizer failed:', summarizerResult.reason);
      emit({ stage: 'summarizer', status: 'failed', duration: stage12Duration, detail: 'agent error' });
    }
  } catch (error) {
    // If aborted, rethrow to skip remaining stages
    // abandon further stages on signal interrupt
    if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) {
      console.log('[pipeline] Stage 1+2 aborted by user');
      throw error;
    }
    // log stage failure properties to variable store
    stages.failedStage = 'curator+summarizer';
    stages.error = error instanceof Error ? error.message : String(error);
    console.log('[pipeline] Stage 1+2 error:', stages.error);
  }

  // ── Abort check between stages ──
  // ensure execution halts on event interrupt
  if (signal?.aborted) {
    console.log('[pipeline] Aborted before Stage 3');
    throw new DOMException('Aborted', 'AbortError');
  }

  // ── Stage 3: Analyst ────────────────────────────────────────────
  // define analysis storage variable
  let analysis: TrendAnalysis | null = null;

  try {
    // track step duration and emit status
    const t1 = Date.now();
    console.log('[pipeline] Stage 3 (Analyst) start');
    emit({ stage: 'analyst', status: 'running' });
    // spin up instance of analysis unit
    const analystAgent = createAnalystAgent(env, enrichedItems, historyItems, sandbox);
    const analystResult = await streamWithProgress(analystAgent, buildAnalystPrompt(enrichedItems, CONFIG.PROMPT_MAX_ITEMS, noNewItems), 'analyst', emit, CONFIG.AGENT_STREAM_PROGRESS_INTERVAL_MS, signal);
    // parse model results into object structure
    const raw = String(analystResult.finalOutput || '');
    const parsed = parseJsonFromText<TrendAnalysis>(raw);
    const d1 = +(((Date.now() - t1) / 1000).toFixed(1));
    // evaluate validity of properties in parsed chunk
    if (parsed?.keyInsight || parsed?.categories?.length) {
      analysis = parsed;
      stages.analystOutput = analysis;
      // Write back Analyst scores (0-100) to enrichedItems for sorting and display.
      // attach quantitative model metrics to existing list shapes
      if (analysis.scores?.length) {
        const scoreMap = new Map(analysis.scores.map(s => [s.id, s.score]));
        enrichedItems = enrichedItems.map(item => {
          const aiScore = scoreMap.get(item.id);
          return aiScore != null ? { ...item, score: aiScore } : item;
        });
      }
      // compute totals and post them to event listener
      const categoryCount = analysis.categories?.length || 0;
      const deepDiveCount = analysis.deepDives?.length || 0;
      const detail = `${categoryCount} categories, ${deepDiveCount} deep dives`;
      console.log(`[pipeline] Analyst done (${d1}s): ${detail}`);
      emit({ stage: 'analyst', status: 'done', duration: d1, detail });
      // Phase 4 of progressive content: emit categories + scored items so
      // frontend can re-group, show keyInsight, and update displayed scores.
      // push processed details toward client layer
      emit({
        type: 'analysis',
        categories: analysis.categories || [],
        deepDives: analysis.deepDives || [],
        keyInsight: analysis.keyInsight,
      });
      // Re-emit items with Analyst scores so frontend LiveFeed picks up 0-100 scores.
      // send augmented objects downstream
      emit({ type: 'items', phase: 'summarized', items: enrichedItems });
    } else {
      // surface broken structure state message
      console.log(`[pipeline] Analyst done (${d1}s): output parse failed`);
      console.log(`[pipeline] Analyst raw output (first 500 chars):`, raw.slice(0, 500));
      emit({ stage: 'analyst', status: 'failed', duration: d1, detail: 'parse failed' });
    }
  } catch (error) {
    // bail out when user stops request explicitly
    if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) {
      console.log('[pipeline] Stage 3 aborted by user');
      throw error;
    }
    // log explicit analyst failure cases
    stages.failedStage = stages.failedStage || 'analyst';
    stages.error = stages.error || (error instanceof Error ? error.message : String(error));
    console.log('[pipeline] Analyst error:', stages.error);
    emit({ stage: 'analyst', status: 'failed', detail: stages.error });
  }

  // ── Abort check between stages ──
  // stop executing if aborted
  if (signal?.aborted) {
    console.log('[pipeline] Aborted before Stage 4');
    throw new DOMException('Aborted', 'AbortError');
  }

  // ── Stage 4: Writer (token-streaming with non-stream fallback) ───
  try {
    // track step timing and prep logic vars
    const t2 = Date.now();
    console.log('[pipeline] Stage 4 (Writer) start — streaming');
    emit({ stage: 'writer', status: 'running' });
    // instantiate write engine for prose output
    const writerAgent = createWriterAgent(env);
    const writerPrompt = buildWriterPrompt(enrichedItems, analysis, CONFIG.PROMPT_MAX_ITEMS, noNewItems);

    let markdown = '';

    try {
      // Primary path: stream tokens to the client for live-typing UX.
      // track token logic internal buffer pieces
      let accumulated = '';
      let insideThink = false; // Track if we're inside <think>...</think>
      let thinkBuffer = '';    // Buffer to detect partial <think> or </think> tags
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      // trigger final report block with streaming mode on
      const writerStreamResult = await run(writerAgent, writerPrompt, { stream: true, signal });

      // cycle over chunked output events in stream buffer
      for await (const event of writerStreamResult.toStream() as AsyncIterable<unknown>) {
        if (signal?.aborted) break;
        const ev = event as { type?: string; data?: { type?: string; delta?: unknown } };
        // isolate block events to filter formatting
        if (ev.type === 'raw_model_stream_event' && ev.data?.type === 'output_text_delta') {
          const delta = String(ev.data.delta || '');
          if (delta) {
            accumulated += delta;
            // Filter out <think>...</think> from live stream
            // merge text into string cache array
            thinkBuffer += delta;
            if (insideThink) {
              // search string to see if end tag present
              const closeIdx = thinkBuffer.indexOf('</think>');
              if (closeIdx !== -1) {
                // pull string data following boundary out of buffer
                insideThink = false;
                const afterClose = thinkBuffer.slice(closeIdx + 8);
                thinkBuffer = '';
                if (afterClose) emit({ type: 'token', delta: afterClose });
              }
              // else: still inside think, swallow token
            } else {
              // search string to see if boundary tags appeared
              const openIdx = thinkBuffer.indexOf('<think>');
              if (openIdx !== -1) {
                // emit characters generated ahead of bracket
                insideThink = true;
                const beforeOpen = thinkBuffer.slice(0, openIdx);
                thinkBuffer = thinkBuffer.slice(openIdx + 7);
                if (beforeOpen) emit({ type: 'token', delta: beforeOpen });
              } else if (thinkBuffer.length > 7) {
                // Safe to flush — no partial <think> tag possible
                // clear token chunks safely out of buffer queue
                const safe = thinkBuffer.slice(0, -7);
                thinkBuffer = thinkBuffer.slice(-7);
                emit({ type: 'token', delta: safe });
              }
            }
          }
        }
      }
      // Flush remaining buffer (if not inside think)
      // emit any residual tokens left after iteration
      if (!insideThink && thinkBuffer) {
        emit({ type: 'token', delta: thinkBuffer });
      }

      // finalize combined chunk text string
      const finalOutput = (writerStreamResult as { finalOutput?: string }).finalOutput;
      markdown = stripThinkingTags(
        (typeof finalOutput === 'string' && finalOutput.trim())
          ? finalOutput.trim()
          : accumulated.trim()
      );
    } catch (streamError) {
      // If aborted, rethrow — don't retry
      // kill fallback behavior if stopped purposely
      if (signal?.aborted || (streamError instanceof Error && streamError.name === 'AbortError')) {
        throw streamError;
      }
      // Fallback: if streaming fails ("terminated", connection reset, etc.),
      // retry without streaming. User won't see live-typing but still gets the report.
      // print errors then trigger plain non-streaming completion
      const msg = streamError instanceof Error ? streamError.message : String(streamError);
      console.warn(`[pipeline] Writer stream failed (${msg}), retrying without stream`);
      console.warn(`[pipeline] Writer full error:`, streamError);
      // clean output string before saving
      const writerResult = await run(writerAgent, writerPrompt, { signal });
      markdown = stripThinkingTags(String(writerResult.finalOutput || '').trim());
    }

    // output text metrics to status stream log
    const d2 = +(((Date.now() - t2) / 1000).toFixed(1));
    if (markdown && markdown.length > 50) {
      stages.writerMarkdown = markdown;
      const detail = `${markdown.length} chars`;
      console.log(`[pipeline] Writer done (${d2}s): ${detail}`);
      emit({ stage: 'writer', status: 'done', duration: d2, detail });
      // return successfully crafted end output object
      return { report: assembleReportFromWriter(enrichedItems, markdown, runId, trigger), stages };
    }
    // log empty text validation cases
    console.log(`[pipeline] Writer done (${d2}s): output too short`);
    emit({ stage: 'writer', status: 'failed', duration: d2, detail: 'output too short' });
  } catch (error) {
    // intercept hard cancellation exceptions
    if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) {
      console.log('[pipeline] Stage 4 aborted by user');
      throw error;
    }
    // log general writer layer crashes
    stages.failedStage = stages.failedStage || 'writer';
    stages.error = stages.error || (error instanceof Error ? error.message : String(error));
    console.log('[pipeline] Writer error:', stages.error);
    emit({ stage: 'writer', status: 'failed', detail: stages.error });
  }

  // ── Fallback from Analyst output ────────────────────────────────
  // use structured chunks when generated prose report isn't present
  if (analysis) {
    console.log('[pipeline] Falling back to analyst-based report');
    return { report: assembleReportFromAnalysis(enrichedItems, analysis, runId, trigger), stages };
  }

  // ── Ultimate fallback ───────────────────────────────────────────
  // dump items directly via system backup tool
  console.log('[pipeline] All agents failed, using code-generated fallback');
  const fallback = generateFallbackReport(enrichedItems, runId, trigger);
  fallback.agentWarning = stages.error || 'All agents failed';
  return { report: fallback, stages };
}
