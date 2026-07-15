import { z } from 'zod';

// define structure for a raw trend item
export interface TrendSourceItem {
  id: string;
  source?: string;
  title: string;
  url: string;
  score?: number;
// optional metadata for trend items
  publishedAt?: string;
  summary?: string;
  aiSummary?: string;
  fingerprint?: string;
// tracking metrics for the item
  firstSeenAt?: string;
  lastSeenAt?: string;
  seenCount?: number;
  isNew?: boolean;
  category?: string;
}

// define group of related trend items
export interface TrendGroup {
  category: string;
  summary: string;
  count: number;
  items: TrendSourceItem[];
}

// define full trend report structure
export interface TrendReport {
  runId: string;
  status: 'success' | 'failed' | 'empty' | string;
  trigger?: string;
  generatedAt: string;
// execution details and counts
  durationMs?: number;
  itemCount: number;
  newItemCount?: number;
  reusedItemCount?: number;
  itemIds?: string[];
// generated content and groupings
  summary: string;
  reportMarkdown: string;
  trends: TrendGroup[];
  items: TrendSourceItem[];
// additional configuration and state
  sources?: string[];
  schedule?: unknown;
  noNewItems?: boolean;
  error?: string;
  agentWarning?: string;
  storage?: 'memory' | 'file-fallback' | 'empty';
}

// define simplified history record
export interface HistoryEntry {
  runId?: string;
  status?: string;
  trigger?: string;
  generatedAt?: string;
// summary statistics for the run
  itemCount?: number;
  newItemCount?: number;
  reusedItemCount?: number;
  summary?: string;
  error?: string;
  storage?: 'memory' | 'file-fallback' | 'empty';
}

// ── Agent I/O Schemas (Zod) ───────────────────────────────────────

// Agent 1: Curator output
// schema for single curated item
export const CuratedItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  url: z.string(),
  source: z.string().optional(),
// curation reasoning and decision
  category: z.string().describe('AI Agent / LLM / Multimodal / Open Source Model / AI Infra / AI Industry'),
  reason: z.string().describe('Brief reason for keep/drop decision (Chinese)'),
  keep: z.boolean().describe('true to include, false to drop'),
});
// type for single curated item
export type CuratedItem = z.infer<typeof CuratedItemSchema>;

// schema for overall curator output
export const CuratorOutputSchema = z.object({
  items: z.array(CuratedItemSchema),
  droppedCount: z.number(),
  curatorNotes: z.string().describe('Brief summary of curation decisions'),
});
// type for overall curator output
export type CuratorOutput = z.infer<typeof CuratorOutputSchema>;

// Agent 2: Summarizer output
// schema for summarized item
export const SummarizedItemSchema = z.object({
  id: z.string(),
  aiSummary: z.string().describe('1-2 sentence Chinese summary'),
});
// type for summarized item
export type SummarizedItem = z.infer<typeof SummarizedItemSchema>;

// schema for overall summarizer output
export const SummarizerOutputSchema = z.object({
  items: z.array(SummarizedItemSchema),
});
// type for overall summarizer output
export type SummarizerOutput = z.infer<typeof SummarizerOutputSchema>;

// Agent 3: Analyst output
// schema for analyst categorized item
export const AnalystCategoryItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.enum(['new', 'active', 'single']),
  importance: z.enum(['high', 'medium', 'low']),
});

// schema for analyst category group
export const AnalystCategorySchema = z.object({
  name: z.string(),
  items: z.array(AnalystCategoryItemSchema),
});

// schema for deep dive insight
export const DeepDiveSchema = z.object({
  id: z.string(),
  title: z.string(),
  insight: z.string().describe('One-sentence analysis from fetch_url'),
});

// schema for overall trend analysis
export const TrendAnalysisSchema = z.object({
  categories: z.array(AnalystCategorySchema),
  deepDives: z.array(DeepDiveSchema).optional(),
  keyInsight: z.string().describe('Core insight in under 80 chars (Chinese)'),
// item scores from analyst
  scores: z.array(z.object({
    id: z.string(),
    score: z.number().describe('0-100 综合推荐分'),
  })).describe('每条保留资讯的综合推荐评分（0-100）'),
});
// type for overall trend analysis
export type TrendAnalysis = z.infer<typeof TrendAnalysisSchema>;

// Keep legacy TrendEntry for backward compat with report assembly
// schema for legacy trend entry
export const TrendEntrySchema = z.object({
  trendName: z.string(),
  status: z.enum(['new', 'rising', 'stable', 'cooling']),
  description: z.string().describe('2-3 sentence Chinese description'),
  impact: z.enum(['high', 'medium', 'low']),
  relatedItemIds: z.array(z.string()).describe('IDs of items supporting this trend'),
});
// type for legacy trend entry
export type TrendEntry = z.infer<typeof TrendEntrySchema>;

// Agent 4: Writer output
// schema for final generated report
export const FinishedReportSchema = z.object({
  reportMarkdown: z.string().describe('Full Markdown trend report'),
  summary: z.string().describe('One-line summary for metadata'),
  followUpQuestions: z.array(z.string()).describe('2-5 follow-up questions worth tracking'),
});
// type for final generated report
export type FinishedReport = z.infer<typeof FinishedReportSchema>;

// Tool parameter schemas
// schema for history fetch parameters
export const GetHistoryItemsParamsSchema = z.object({
  maxItems: z.number().optional().describe('Maximum historical items to retrieve (default 50)'),
  daysBack: z.number().optional().describe('How many days back to look (default 7)'),
});

// schema for period comparison parameters
export const ComparePeriodsParamsSchema = z.object({
  currentItemIds: z.array(z.string()).describe('IDs of items in the current period'),
  metric: z.enum(['count', 'categories', 'sources']).describe('Dimension to compare'),
});

// ── Streaming Event Schema ────────────────────────────────────────
// Discriminated union for SSE pipeline events. Backend emits these via
// `data: ${JSON.stringify(event)}\n\n` — frontend dispatches by `type`.

// define pipeline stages and statuses
export type StageKey = 'fetch' | 'curator' | 'summarizer' | 'analyst' | 'writer';
export type StageStatus = 'running' | 'done' | 'failed' | 'skipped';
export type ItemPhase = 'fetched' | 'curated' | 'summarized';

// define event for analyst categorization
export interface AnalystCategoryEvent {
  name: string;
  items: Array<{ id: string; title: string; status: 'new' | 'active' | 'single'; importance: 'high' | 'medium' | 'low' }>;
}

// define event for deep dive insight
export interface AnalystDeepDiveEvent {
  id: string;
  title: string;
  insight: string;
}

// define streaming event union type
export type StreamEvent =
  // Stage status transitions (kept compatible with old PipelineEvent shape)
  | { type: 'stage'; stage: StageKey; status: StageStatus; duration?: number; detail?: string }
  // Progressive content snapshots emitted at stage boundaries
  | { type: 'items'; phase: ItemPhase; items: TrendSourceItem[] }
  // Analyst structured output
  | { type: 'analysis'; categories: AnalystCategoryEvent[]; deepDives?: AnalystDeepDiveEvent[]; keyInsight?: string }
  // In-progress streaming indicator (emitted every few seconds during long LLM calls)
  | { type: 'progress'; stage: StageKey; tokenCount: number; chars: number }
  // Writer token streaming (Phase 2 — declared now, emitted later)
  | { type: 'token'; delta: string }
  // Terminal events
  | { type: 'complete'; report: TrendReport }
  | { type: 'error'; detail: string };

// Backward-compat alias (existing code path uses bare-shape events without `type`)
// define legacy pipeline event type
export type PipelineEvent =
  | { stage: StageKey | 'complete' | 'error'; status: StageStatus; duration?: number; detail?: string; report?: TrendReport }
  | StreamEvent;
