import type { TrendSourceItem } from './_pipeline_types.js';

// define url query parameters to remove
const TRACKING_PARAMS = new Set(['ref', 'source']);

// extend trend item with library metadata
export interface TrendLibraryItem extends TrendSourceItem {
  fingerprint?: string;
  firstSeenAt?: string;
  lastSeenAt?: string;
  seenCount?: number;
  isNew?: boolean;
}

// define output structure for library merge
export interface MergeResult {
  items: TrendLibraryItem[];
  newItems: TrendLibraryItem[];
  reusedItems: TrendLibraryItem[];
  reportItems: TrendLibraryItem[];
  newItemCount: number;
  reusedItemCount: number;
}

// clean and standardize url string
export function normalizeUrl(value: unknown): string {
  const raw = String(value || '').trim();
  try {
// parse url and validate protocol
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol)) return '';
// strip tracking query parameters
    [...url.searchParams.keys()].forEach(key => {
      const lower = key.toLowerCase();
      if (lower.startsWith('utm_') || TRACKING_PARAMS.has(lower)) url.searchParams.delete(key);
    });
// normalize url components
    url.hash = '';
    url.hostname = url.hostname.toLowerCase();
    url.pathname = url.pathname.replace(/\/+$/, '') || '/';
    return url.toString();
  } catch {
    return '';
  }
}

// standardize title formatting
export function normalizeTitle(value: unknown): string {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

// generate unique identifier for an item
export function fingerprintItem(item: TrendSourceItem): string {
  const normalized = normalizeUrl(item.url);
  return normalized || `title:${normalizeTitle(item.title)}`;
}

// initialize metadata for a new item
function prepareNewItem(item: TrendSourceItem, fingerprint: string, now: string): TrendLibraryItem {
  return {
    ...item,
    url: normalizeUrl(item.url),
    fingerprint,
// set initial tracking timestamps and flags
    firstSeenAt: now,
    lastSeenAt: now,
    seenCount: 1,
    isNew: true,
  };
}

// merge new data into an existing item
function updateExistingItem(existing: TrendLibraryItem, candidate: TrendSourceItem, now: string): TrendLibraryItem {
  return {
    ...existing,
// update timestamps and interaction count
    lastSeenAt: now,
    seenCount: (existing.seenCount || 1) + 1,
// merge scores and summaries
    score: Math.max(existing.score || 0, candidate.score || 0),
    summary: existing.summary || candidate.summary,
    aiSummary: existing.aiSummary || candidate.aiSummary,
    isNew: false,
  };
}

// pick items to include in the final report
export function selectReportItems(newItems: TrendLibraryItem[], reusedItems: TrendLibraryItem[], limit = 30, library?: TrendLibraryItem[]): TrendLibraryItem[] {
  // Primary: items active in this run (new + reused)
// prioritize new and high scoring items
  const active = [...newItems, ...reusedItems]
    .sort((a, b) => {
      if (Boolean(a.isNew) !== Boolean(b.isNew)) return a.isNew ? -1 : 1;
      if ((b.score || 0) !== (a.score || 0)) return (b.score || 0) - (a.score || 0);
      return String(b.lastSeenAt || '').localeCompare(String(a.lastSeenAt || '')) || a.title.localeCompare(b.title);
    })
    .slice(0, limit);

  // Fill from library if active items not enough
// supplement with older items if needed
  if (active.length < limit && library?.length) {
    const activeIds = new Set(active.map(i => i.fingerprint || fingerprintItem(i)));
    const filler = library
      .filter(i => !activeIds.has(i.fingerprint || fingerprintItem(i)))
      .sort((a, b) => String(b.lastSeenAt || '').localeCompare(String(a.lastSeenAt || '')))
      .slice(0, limit - active.length);
    return [...active, ...filler];
  }

  return active;
}

// integrate fresh items into the existing library
export function mergeItemLibrary(existingItems: TrendLibraryItem[], candidateItems: TrendSourceItem[], now: string, limit = 30): MergeResult {
// index current items by fingerprint
  const library = new Map<string, TrendLibraryItem>();
  existingItems.forEach(item => {
    const fingerprint = item.fingerprint || fingerprintItem(item);
    if (fingerprint) library.set(fingerprint, { ...item, fingerprint, isNew: false });
  });

  const newItems: TrendLibraryItem[] = [];
  const reusedItems: TrendLibraryItem[] = [];

// process each new candidate
  candidateItems.forEach(candidate => {
    const fingerprint = fingerprintItem(candidate);
    if (!fingerprint) return;
    const existed = library.get(fingerprint);
// update existing or create new entry
    if (existed) {
      const updated = updateExistingItem(existed, candidate, now);
      library.set(fingerprint, updated);
      reusedItems.push(updated);
    } else {
      const created = prepareNewItem(candidate, fingerprint, now);
      library.set(fingerprint, created);
      newItems.push(created);
    }
  });

// compile all library elements
  const allLibraryItems = [...library.values()];

// return combined outcome with stats
  return {
    items: allLibraryItems,
    newItems,
    reusedItems,
    reportItems: selectReportItems(newItems, reusedItems, limit, allLibraryItems),
    newItemCount: newItems.length,
    reusedItemCount: reusedItems.length,
  };
}
