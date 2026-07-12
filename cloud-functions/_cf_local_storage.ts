import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

// Inline minimal types (mirrors agents/ai_trends/_pipeline_types.ts)
interface TrendReport {
  runId: string;
  status: string;
  trigger?: string;
  generatedAt: string;
  durationMs?: number;
  itemCount: number;
  newItemCount?: number;
  reusedItemCount?: number;
  summary: string;
  reportMarkdown: string;
  trends: unknown[];
  items: unknown[];
  error?: string;
  storage?: 'memory' | 'file-fallback' | 'empty';
  [key: string]: unknown;
}

interface HistoryEntry {
  runId?: string;
  status?: string;
  trigger?: string;
  generatedAt?: string;
  itemCount?: number;
  newItemCount?: number;
  reusedItemCount?: number;
  summary?: string;
  error?: string;
  storage?: 'memory' | 'file-fallback' | 'empty';
}

export function defaultBaseDir(): string {
  return process.env.AI_TRENDS_DATA_DIR || 'data/ai_trends';
}

function withStorageMarker(report: TrendReport): TrendReport {
  return { ...report, storage: 'file-fallback' };
}

async function ensureBase(baseDir = defaultBaseDir()): Promise<string> {
  await mkdir(join(baseDir, 'reports'), { recursive: true });
  return baseDir;
}

async function readJson<T>(path: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

export async function loadLatestReport(baseDir = defaultBaseDir()): Promise<TrendReport | null> {
  const report = await readJson<TrendReport | null>(join(baseDir, 'latest.json'), null);
  return report ? withStorageMarker(report) : null;
}

export async function loadReportByRunId(runId: string, baseDir = defaultBaseDir()): Promise<TrendReport | null> {
  const safeRunId = runId.split(/[\\/]/).pop() || runId;
  const report = await readJson<TrendReport | null>(join(baseDir, 'reports', `${safeRunId}.json`), null);
  return report ? withStorageMarker(report) : null;
}

export async function loadHistory(baseDir = defaultBaseDir()): Promise<HistoryEntry[]> {
  return readJson<HistoryEntry[]>(join(baseDir, 'history.json'), []);
}

export async function deleteReport(runId: string, baseDir = defaultBaseDir()): Promise<boolean> {
  try {
    const base = await ensureBase(baseDir);
    const safeRunId = runId.split(/[\\/]/).pop() || runId;
    await rm(join(base, 'reports', `${safeRunId}.json`), { force: true });

    const history = await loadHistory(base);
    const next = history.filter(entry => entry.runId !== runId);
    await writeFile(join(base, 'history.json'), JSON.stringify(next, null, 2), 'utf8');

    const latest = await loadLatestReport(base);
    if (latest && latest.runId === runId) {
      if (next.length > 0) {
        const newLatest = await loadReportByRunId(next[0].runId!, base);
        if (newLatest) {
          await writeFile(join(base, 'latest.json'), JSON.stringify(newLatest, null, 2), 'utf8');
        } else {
          await rm(join(base, 'latest.json'), { force: true });
        }
      } else {
        await rm(join(base, 'latest.json'), { force: true });
      }
    }
    return true;
  } catch {
    return false;
  }
}
