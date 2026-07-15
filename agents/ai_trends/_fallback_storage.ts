import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { HistoryEntry, TrendReport } from './_pipeline_types.js';

// define default storage directory path
export function defaultBaseDir(): string {
  return process.env.AI_TRENDS_DATA_DIR || 'data/ai-trends';
}

// add storage source marker to report
function withStorageMarker(report: TrendReport, storage: 'memory' | 'file-fallback'): TrendReport {
  return { ...report, storage };
}

// create base and reports directories if missing
async function ensureBase(baseDir = defaultBaseDir()): Promise<string> {
  await mkdir(join(baseDir, 'reports'), { recursive: true });
  return baseDir;
}

// read and parse json file with fallback
async function readJson<T>(path: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

// save trend report to local filesystem
export async function saveReport(payload: TrendReport, baseDir = defaultBaseDir()): Promise<void> {
// ensure directory exists before writing
  const base = await ensureBase(baseDir);
// write report to latest and runid files
  await writeFile(join(base, 'latest.json'), JSON.stringify(payload, null, 2), 'utf8');
  await writeFile(join(base, 'reports', `${payload.runId}.json`), JSON.stringify(payload, null, 2), 'utf8');

// prepare summary entry for history log
  const history = await loadHistory(base);
  const summary: HistoryEntry = {
    runId: payload.runId,
    status: payload.status,
    trigger: payload.trigger,
    generatedAt: payload.generatedAt,
    itemCount: payload.itemCount,
    newItemCount: payload.newItemCount,
    reusedItemCount: payload.reusedItemCount,
    summary: payload.summary,
    error: payload.error,
  };
// update history list and keep recent 30 entries
  const next = [summary, ...history.filter(entry => entry.runId !== summary.runId)].slice(0, 30);
  await writeFile(join(base, 'history.json'), JSON.stringify(next, null, 2), 'utf8');
}

// read the most recently saved report
export async function loadLatestReport(baseDir = defaultBaseDir()): Promise<TrendReport | null> {
  const report = await readJson<TrendReport | null>(join(baseDir, 'latest.json'), null);
  return report ? withStorageMarker(report, 'file-fallback') : null;
}

// load a specific report by its run id safely
export async function loadReport(runId: string, baseDir = defaultBaseDir()): Promise<TrendReport | null> {
  const safeRunId = runId.split(/[\\/]/).pop() || runId;
  const report = await readJson<TrendReport | null>(join(baseDir, 'reports', `${safeRunId}.json`), null);
  return report ? withStorageMarker(report, 'file-fallback') : null;
}

// fetch the saved history entries list
export async function loadHistory(baseDir = defaultBaseDir()): Promise<HistoryEntry[]> {
  return readJson<HistoryEntry[]>(join(baseDir, 'history.json'), []);
}

// write item library array to storage file
export async function saveItemLibrary(items: unknown[], baseDir = defaultBaseDir()): Promise<void> {
  const base = await ensureBase(baseDir);
  await writeFile(join(base, 'items.json'), JSON.stringify(items, null, 2), 'utf8');
}

// retrieve item library array from storage
export async function loadItemLibrary<T = unknown>(baseDir = defaultBaseDir()): Promise<T[]> {
  return readJson<T[]>(join(baseDir, 'items.json'), []);
}
