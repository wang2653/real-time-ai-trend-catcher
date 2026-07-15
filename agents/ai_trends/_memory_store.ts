import type { HistoryEntry, TrendReport, TrendSourceItem } from './_pipeline_types.js';

// define constants for memory storage
const REPORT_CONVERSATION_ID = 'ai-trends-reports';
const ITEM_CONVERSATION_ID = 'ai-trends-items';
const REPORT_KIND = 'ai_trends_report';
const ITEM_SNAPSHOT_KIND = 'ai_trends_item_snapshot';

// define structure for memory messages
interface MemoryMessage {
  messageId?: string;
  content?: unknown;
  metadata?: Record<string, unknown>;
}

// define agent memory interface
interface AgentMemoryLike {
  appendMessage(input: {
    conversationId: string;
    role: 'assistant' | 'tool';
    content: string;
    metadata: Record<string, unknown>;
  }): Promise<string>;
// define method to retrieve messages
  getMessages(input: {
    conversationId: string;
    limit?: number;
    order?: 'asc' | 'desc';
  }): Promise<MemoryMessage[]>;
// define optional methods for deletion
  deleteMessage?(input: { conversationId: string; messageId: string }): Promise<void>;
  clearMessages?(input: { conversationId: string }): Promise<void>;
}

// extract memory instance from context safely
function getMemory(context: unknown): AgentMemoryLike | null {
  const memory = (context as { store?: AgentMemoryLike } | null)?.store;
// check for required methods
  if (!memory || typeof memory.appendMessage !== 'function' || typeof memory.getMessages !== 'function') return null;
  return memory;
}

// parse trend report from message
function parseReportMessage(message: MemoryMessage): TrendReport | null {
// ensure message is a report
  if (message.metadata?.kind !== REPORT_KIND) return null;
// handle object content
  const content = message.content;
  if (typeof content === 'object' && content !== null) return content as TrendReport;
// attempt to parse string content
  try {
    const parsed = JSON.parse(String(content));
    return parsed && typeof parsed === 'object' ? parsed as TrendReport : null;
  } catch {
    return null;
  }
}

// tag report with storage source
function withStorageMarker(report: TrendReport, storage: 'memory' = 'memory'): TrendReport {
  return { ...report, storage };
}

// map report data to history entry format
function toHistoryEntry(report: TrendReport): HistoryEntry {
  return {
    runId: report.runId,
    status: report.status,
    trigger: report.trigger,
    generatedAt: report.generatedAt,
    itemCount: report.itemCount,
// include optional fields and defaults
    newItemCount: report.newItemCount,
    reusedItemCount: report.reusedItemCount,
    summary: report.summary,
    error: report.error,
    storage: report.storage ?? 'memory',
  };
}

// ── Report persistence (unchanged) ──

// save trend report to memory store
export async function saveReportToMemory(context: unknown, report: TrendReport): Promise<boolean> {
  const memory = getMemory(context);
  if (!memory) return false;
// append report message to conversation
  await memory.appendMessage({
    conversationId: REPORT_CONVERSATION_ID,
    role: 'assistant',
    content: JSON.stringify(report),
// attach report metadata
    metadata: {
      kind: REPORT_KIND,
      runId: report.runId,
      status: report.status,
      summary: report.summary,
      itemCount: report.itemCount,
      trigger: report.trigger,
    },
  });
  return true;
}

// fetch reports from memory up to a limit
async function loadReports(context: unknown, limit = 30): Promise<TrendReport[]> {
  const memory = getMemory(context);
  if (!memory) return [];
// load latest messages within safe bounds
  try {
    const safeLimit = Math.min(limit, 100);
    const messages = await memory.getMessages({ conversationId: REPORT_CONVERSATION_ID, limit: safeLimit, order: 'desc' });
    const seen = new Set<string>();
    const reports: TrendReport[] = [];
// process and deduplicate reports
    for (const message of messages) {
      const report = parseReportMessage(message);
      if (!report) continue;
// skip if runid already processed
      if (report.runId && seen.has(report.runId)) continue;
      if (report.runId) seen.add(report.runId);
      reports.push(withStorageMarker(report));
    }
    return reports;
  } catch {
    return [];
  }
}

// retrieve the most recent report
export async function loadLatestReportFromMemory(context: unknown): Promise<TrendReport | null> {
  const reports = await loadReports(context, 1);
  return reports[0] ?? null;
}

// load history entries from recent reports
export async function loadHistoryFromMemory(context: unknown): Promise<HistoryEntry[]> {
  const reports = await loadReports(context, 30);
  return reports.map(toHistoryEntry);
}

// find specific report by its run id
export async function loadReportFromMemory(context: unknown, runId: string): Promise<TrendReport | null> {
  const reports = await loadReports(context, 100);
  return reports.find(report => report.runId === runId) ?? null;
}

// ── Item library persistence (snapshot strategy) ──

/**
 * Save the full item library as a single snapshot message.
 * Each run appends ONE message containing the entire items array.
 * Old snapshots are cleaned up when count exceeds threshold.
 */
// store complete item array in memory snapshot
export async function saveItemsToMemory(context: unknown, items: TrendSourceItem[]): Promise<boolean> {
  const memory = getMemory(context);
  if (!memory) return false;
// construct and append snapshot message
  await memory.appendMessage({
    conversationId: ITEM_CONVERSATION_ID,
    role: 'tool',
    content: JSON.stringify(items),
// attach snapshot metadata
    metadata: {
      kind: ITEM_SNAPSHOT_KIND,
      itemCount: items.length,
      savedAt: new Date().toISOString(),
    },
  });
  return true;
}

/**
 * Load the item library from the latest snapshot message.
 * Reads only 1 message (the most recent snapshot), parses the full array.
 */
// retrieve item array from latest snapshot
export async function loadItemsFromMemory(context: unknown): Promise<TrendSourceItem[]> {
  const memory = getMemory(context);
  if (!memory) return [];
// fetch recent messages for items
  try {
    const messages = await memory.getMessages({ conversationId: ITEM_CONVERSATION_ID, limit: 5, order: 'desc' });
    // Find the latest snapshot message
    for (const message of messages) {
// ignore non-snapshot messages
      if (message.metadata?.kind !== ITEM_SNAPSHOT_KIND) continue;
// safely parse stored item list
      try {
        const items = JSON.parse(String(message.content || '[]'));
        if (Array.isArray(items)) return items;
      } catch {
        continue;
      }
    }
    return [];
  } catch {
    return [];
  }
}

// ── Delete report by runId ──

// remove a specific report from memory
export async function deleteReportFromMemory(context: unknown, runId: string): Promise<boolean> {
  const memory = getMemory(context);
// check if delete operation is supported
  if (!memory || typeof memory.deleteMessage !== 'function') return false;
  try {
// search through recent report messages
    const safeLimit = 100;
    const messages = await memory.getMessages({ conversationId: REPORT_CONVERSATION_ID, limit: safeLimit, order: 'desc' });
// match target report and delete
    for (const message of messages) {
      if (message.metadata?.kind !== REPORT_KIND) continue;
      if (message.metadata?.runId !== runId) continue;
      if (!message.messageId) continue;
      await memory.deleteMessage({ conversationId: REPORT_CONVERSATION_ID, messageId: message.messageId });
      return true;
    }
    return false;
  } catch {
    return false;
  }
}
