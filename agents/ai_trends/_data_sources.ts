import type { TrendSourceItem } from './_pipeline_types.js';
import { AI_KEYWORDS, CATEGORY_KEYWORDS, extractScript } from './_keyword.js';

// return current iso time string
function nowIso(): string {
  return new Date().toISOString();
}

// clean input text
export function cleanText(value: unknown): string {
// convert to string safely
  return String(value || '')
// replace html entities
    .replace(/&#x2F;/g, '/')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
// strip html and urls
    .replace(/<[^>]+>/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
// normalize whitespaces
    .replace(/\s+/g, ' ')
    .trim();
}

// check if string is only a url
function isUrlOnly(value: string): boolean {
  const compact = value.trim().toLowerCase();
  return !compact || /^https?:\/\/\S+$/.test(compact);
}

// generate fallback summary
export function buildFallbackAiSummary(item: TrendSourceItem): string {
// clean up item summary
  const cleanedSummary = cleanText(item.summary);
// use cleaned summary if valid
  if (cleanedSummary && !isUrlOnly(cleanedSummary) && cleanedSummary.length >= 24) {
    return cleanedSummary.slice(0, 220);
  }
// otherwise use title and category
  const title = cleanText(item.title) || '该动态';
  const category = item.category || inferCategory(item);
  return `${category} 动态：${title}。`;
}

// fetch and parse json
async function fetchJson<T>(url: string): Promise<T> {
// send request with custom user agent
  const res = await fetch(url, { headers: { 'User-Agent': 'EdgeOne-Agent-AI-Trends-Node/1.0' } });
// throw on error or return parsed data
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return await res.json() as T;
}

// combine title summary and url
export function normalizeText(item: TrendSourceItem): string {
  return [item.title, item.summary, item.url].filter(Boolean).join(' ').toLowerCase();
}

// infer category from text
export function inferCategory(item: TrendSourceItem): string {
  const text = normalizeText(item);
// match keywords for each category
  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (keywords.some(keyword => text.includes(keyword))) return category;
  }
// fallback category
  return 'AI Industry';
}

// filter items by keywords
export function filterAiItems(items: TrendSourceItem[], keywords: string[] = AI_KEYWORDS): TrendSourceItem[] {
  const activeKeywords = keywords.map(keyword => keyword.toLowerCase());
  const seen = new Set<string>();
  const filtered: TrendSourceItem[] = [];

// process each item
  for (const item of items) {
    const text = normalizeText(item);
// skip if no keywords match
    if (!activeKeywords.some(keyword => text.includes(keyword))) continue;
// skip duplicates
    const key = String(item.url || item.title || item.id).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
// enrich item data
    const enriched = { ...item, summary: cleanText(item.summary), category: item.category ?? inferCategory(item) };
    filtered.push({ ...enriched, aiSummary: buildFallbackAiSummary(enriched) });
  }

  return filtered;
}

// fetch top stories from hacker news
export async function collectHackerNews(limit = 20): Promise<TrendSourceItem[]> {
  try {
// get top item ids
    const ids = (await fetchJson<number[]>('https://hacker-news.firebaseio.com/v0/topstories.json')).slice(0, limit);
// fetch details for each id
    const items: Array<TrendSourceItem | null> = await Promise.all(ids.map(async id => {
      try {
// fetch individual item
        const item = await fetchJson<Record<string, unknown>>(`https://hacker-news.firebaseio.com/v0/item/${id}.json`);
        if (item.type !== 'story') return null;
// parse time
        const time = typeof item.time === 'number' ? new Date(item.time * 1000).toISOString() : nowIso();
// construct trend item
        return {
          id: `hn_${id}`,
          source: 'Hacker News',
          title: String(item.title || 'Untitled'),
          url: String(item.url || `https://news.ycombinator.com/item?id=${id}`),
          score: typeof item.score === 'number' ? item.score : 0,
          publishedAt: time,
          summary: typeof item.text === 'string' ? item.text : '',
        } satisfies TrendSourceItem;
      } catch {
        return null;
      }
    }));
// return valid items
    return items.filter((item): item is TrendSourceItem => Boolean(item));
  } catch {
    return [];
  }
}

// fetch latest ai articles from devto
export async function collectDevto(limit = 20): Promise<TrendSourceItem[]> {
  try {
// get data from devto api
    const data = await fetchJson<Record<string, unknown>[]>(`https://dev.to/api/articles?tag=ai&per_page=${limit}`);
// map to trend item structure
    return data.slice(0, limit).map(article => ({
      id: `devto_${String(article.id || article.path || article.url)}`,
      source: 'Dev.to',
      title: String(article.title || 'Untitled'),
      url: String(article.url || 'https://dev.to'),
      score: typeof article.public_reactions_count === 'number' ? article.public_reactions_count : 0,
      publishedAt: typeof article.published_at === 'string' ? article.published_at : nowIso(),
      summary: typeof article.description === 'string' ? article.description : '',
    }));
  } catch {
    return [];
  }
}

// ── Sandbox browser: scrape JS-rendered pages ──

/** Default web sources that require sandbox to fetch */
// define default web sources array
const DEFAULT_WEB_SOURCES = [
  {
// target 36kr ai news
    url: 'https://36kr.com/information/AI/',
    source: '36kr',
    // url: 'https://hellogithub.com/',
    // source: 'GitHub',
// specify method and extraction script
    method: 'browser' as const,
    extractScript,
  },
];

/**
 * Collect items from web pages via sandbox capabilities.
 * - method='browser': sandbox.browser.goto + evaluate (for JS-rendered SPAs)
 * - method='curl': sandbox.commands.run('curl ...') (for SSR pages)
 * Returns [] gracefully when sandbox is unavailable.
 */
// collect data using sandbox browser
export async function collectFromWeb(
  sandbox: unknown,
  webSources: typeof DEFAULT_WEB_SOURCES = DEFAULT_WEB_SOURCES,
  limit = 10,
): Promise<TrendSourceItem[]> {
// return empty if no sandbox
  if (!sandbox || typeof sandbox !== 'object') return [];

// cast sandbox to expected type
  const sbx = sandbox as {
    browser?: {
      goto(url: string, opts?: { waitUntil?: string }): Promise<{ success?: boolean; data?: unknown; error?: string }>;
      evaluate(script: string): Promise<{ success?: boolean; data?: unknown; error?: string }>;
    };
    commands?: {
      run(cmd: string, opts?: Record<string, unknown>): Promise<{ stdout?: string; stderr?: string; exitCode?: number }>;
    };
  };

  const allItems: TrendSourceItem[] = [];

// iterate through web sources
  for (const ws of webSources) {
    try {
      if (ws.method === 'browser') {
        // JS-rendered SPA: use sandbox browser
// check if browser is available
        if (!sbx.browser || typeof sbx.browser.goto !== 'function') {
          console.warn(`[sandbox-browser] browser not available, skipping ${ws.url}`);
          continue;
        }
// navigate to page
        console.log(`[sandbox-browser] navigating to ${ws.url}`);
        const nav = await sbx.browser.goto(ws.url, { waitUntil: 'domcontentloaded' });
// handle navigation failure
        console.log(`[sandbox-browser] navigation result:`, JSON.stringify(nav));
        if (nav?.error) {
          console.warn(`[sandbox-browser] navigation failed for ${ws.url}: ${nav.error}`);
          continue;
        }

        // Debug: dump what the browser actually sees
// evaluate debug script
        const debug = await sbx.browser.evaluate(`
          JSON.stringify({
            title: document.title,
            headings: Array.from(document.querySelectorAll('h1,h2,h3,h4')).slice(0,5).map(h => h.textContent?.trim().slice(0,50)),
            newsLinks: Array.from(document.querySelectorAll('a[href*="/news/"]')).slice(0,5).map(a => ({
              href: a.getAttribute('href'),
              text: a.textContent?.trim().slice(0,50),
              inner: a.innerHTML?.slice(0,100)
            }))
          })
        `);
        console.log(`[sandbox-browser] page debug:`, typeof debug?.data === 'string' ? debug.data : JSON.stringify(debug?.data));

// execute extraction script
        const result = await sbx.browser.evaluate(ws.extractScript!);
// check for extraction errors
        if (!result?.success || !result?.data) {
          console.warn(`[sandbox-browser] evaluate failed for ${ws.url}: ${result?.error || 'no data'}`);
          continue;
        }
// parse raw extracted items
        const rawItems: Array<{ title: string; url: string; score?: number; summary?: string }> = (() => {
          const d = result.data;
          if (typeof d === 'string') { try { return JSON.parse(d); } catch { return []; } }
          return Array.isArray(d) ? d : [];
        })();

// format and store valid items
        for (let i = 0; i < Math.min(rawItems.length, limit); i++) {
          const raw = rawItems[i];
// skip if missing title or url
          if (!raw.title || !raw.url) continue;
// build standard item
          allItems.push({
            id: `web_${Buffer.from(raw.url).toString('base64url').slice(0, 24)}`,
            source: ws.source,
            title: cleanText(raw.title),
            url: raw.url.startsWith('http') ? raw.url : new URL(raw.url, ws.url).href,
            score: raw.score ?? 0, // Web 源无真实互动数据，Agent 会根据内容综合打分
            publishedAt: nowIso(),
            summary: raw.summary || '',
          });
        }
        console.log(`[sandbox-browser] collected ${allItems.length} items from ${ws.source}`);
      }
    } catch (error: any) {
// log web collection errors
      console.warn(`[sandbox-web] failed for ${ws.url}:`, {
        message: error?.message,
        name: error?.name,
        status: error?.status || error?.statusCode,
        code: error?.code,
        stderr: error?.stderr,
        stack: error?.stack?.split('\n').slice(0, 3).join('\n'),
      });
    }
  }

// return items up to limit
  return allItems.slice(0, limit);
}

// ── Unified collection ──

// orchestrate data collection from all sources
export async function collectSources(
  sources: string[] = ['hackernews', 'devto'],
  limit = 30,
  sandbox?: unknown,
): Promise<TrendSourceItem[]> {
  // fetch data from sources concurrently
  const batches = await Promise.all([
    sources.includes('hackernews') ? collectHackerNews(40) : Promise.resolve([]),
    sources.includes('devto') ? collectDevto(25) : Promise.resolve([]),
    sources.includes('web') ? collectFromWeb(sandbox ?? null, DEFAULT_WEB_SOURCES, 25) : Promise.resolve([]),
  ]);

  // apply filters to all items through AI keywords uniformly
  const [hnItems, devtoItems, webItems] = batches;
  const filteredHn = filterAiItems(hnItems);
  const filteredDevto = filterAiItems(devtoItems);
  const filteredWeb = filterAiItems(webItems);

  console.log(`[sources] after filter — HN: ${filteredHn.length}, DevTo: ${filteredDevto.length}, Web: ${filteredWeb.length}`);

  // calculate slots per source HN 40% / DevTo 30% / Web 30%
  const hnSlots = Math.min(filteredHn.length, Math.ceil(limit * 0.4));
  const devtoSlots = Math.min(filteredDevto.length, Math.ceil(limit * 0.3));
  const webSlots = Math.min(filteredWeb.length, Math.ceil(limit * 0.3));

  // merge selected items, any source has fewer items than its allocation, redistribute
  const selected = [
    ...filteredHn.slice(0, hnSlots),
    ...filteredDevto.slice(0, devtoSlots),
    ...filteredWeb.slice(0, webSlots),
  ];

  // return final list bounded by limit
  return selected.slice(0, limit);
}
