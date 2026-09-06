import type { TrendSourceItem } from './_pipeline_types.js';

export type CoreCategory = 'AI Agent' | 'LLM' | 'Multimodal' | 'Infra' | 'Other';

export interface CategoryMetric {
  name: CoreCategory;
  count: number;
  share: number; // percentage in current cycle, e.g. 40.0
  previousCount: number;
  previousShare: number; // percentage in previous cycle
  delta: number; // share - previousShare (percentage points difference, e.g. +5.0 or -3.2)
}

export interface CategoryDistributionStats {
  totalCurrent: number;
  totalPrevious: number;
  categories: CategoryMetric[];
}

/**
 * Normalizes any freeform or source category string into one of the 4 core categories:
 * - AI Agent
 * - LLM
 * - Multimodal
 * - Infra (maps from AI Infra / Infrastructure / RAG / Vector DB)
 * - Other (fallback for Open Source Model, AI Industry, etc.)
 */
export function normalizeCoreCategory(raw?: string): CoreCategory {
  if (!raw) return 'Other';
  const c = raw.trim().toLowerCase();

  // Match AI Agent
  if (c.includes('agent') || c.includes('智能体') || c.includes('mcp')) {
    return 'AI Agent';
  }

  // Match LLM
  if (c.includes('llm') || c.includes('language model') || c.includes('大语言模型') || c.includes('大模型')) {
    return 'LLM';
  }

  // Match Multimodal
  if (c.includes('multimodal') || c.includes('多模态') || c.includes('vision') || c.includes('audio') || c.includes('video') || c.includes('image')) {
    return 'Multimodal';
  }

  // Match Infra (AI Infra, infrastructure, RAG, vector database, inference, gpu, serving)
  if (c.includes('infra') || c.includes('rag') || c.includes('vector') || c.includes('gpu') || c.includes('serving') || c.includes('inference') || c.includes('基础设施')) {
    return 'Infra';
  }

  return 'Other';
}

/**
 * Calculates pure statistical distribution and cycle-over-cycle proportion change
 * for AI Agent, LLM, Multimodal, and Infra.
 * Zero AI or LLM dependency.
 */
export function calculateCategoryDistribution(
  currentItems: TrendSourceItem[] = [],
  historyItems: TrendSourceItem[] = [],
): CategoryDistributionStats {
  const currentCounts: Record<CoreCategory, number> = {
    'AI Agent': 0,
    LLM: 0,
    Multimodal: 0,
    Infra: 0,
    Other: 0,
  };

  const previousCounts: Record<CoreCategory, number> = {
    'AI Agent': 0,
    LLM: 0,
    Multimodal: 0,
    Infra: 0,
    Other: 0,
  };

  for (const item of currentItems) {
    const cat = normalizeCoreCategory(item.category);
    currentCounts[cat] += 1;
  }

  for (const item of historyItems) {
    const cat = normalizeCoreCategory(item.category);
    previousCounts[cat] += 1;
  }

  const totalCurrent = currentItems.length;
  const totalPrevious = historyItems.length;

  const coreList: CoreCategory[] = ['AI Agent', 'LLM', 'Multimodal', 'Infra'];
  // Include 'Other' only if there are current items under Other
  if (currentCounts['Other'] > 0 || previousCounts['Other'] > 0) {
    coreList.push('Other');
  }

  const categories: CategoryMetric[] = coreList.map(name => {
    const count = currentCounts[name] || 0;
    const previousCount = previousCounts[name] || 0;
    const share = totalCurrent > 0 ? +((count / totalCurrent) * 100).toFixed(1) : 0;
    const previousShare = totalPrevious > 0 ? +((previousCount / totalPrevious) * 100).toFixed(1) : 0;
    // Delta in percentage points: e.g. 40.0% - 35.0% = +5.0%
    const delta = totalPrevious > 0 ? +(share - previousShare).toFixed(1) : 0;

    return {
      name,
      count,
      share,
      previousCount,
      previousShare,
      delta,
    };
  });

  return {
    totalCurrent,
    totalPrevious,
    categories,
  };
}

/**
 * Formats delta badge text with direction indicator (e.g. "+5.2% ▲", "-3.1% ▼", "0.0%")
 */
function formatDeltaText(delta: number, hasHistory: boolean): string {
  if (!hasHistory) return '— (Baseline)';
  if (delta > 0) return `+${delta.toFixed(1)}% ▲`;
  if (delta < 0) return `${delta.toFixed(1)}% ▼`;
  return '0.0%';
}

/**
 * Builds the Markdown section string for Category Distribution.
 * Includes both the machine-readable chart block (for React/frontend rendering)
 * and a standard Markdown comparison table (for raw text / fallback reading).
 */
export function buildCategoryDistributionMarkdown(
  stats: CategoryDistributionStats,
  isChinese: boolean = false,
): string {
  const sectionTitle = isChinese ? '## 分类分布环形图' : '## Category Distribution';
  const subtitle = isChinese
    ? '（AI Agent、LLM、Multimodal、Infra 核心赛道在当前周期中的占比分布及环比变化）'
    : '(Distribution & cycle-over-cycle share change for AI Agent, LLM, Multimodal, and Infra)';

  const chartPayload = JSON.stringify(stats, null, 2);

  const hasHistory = stats.totalPrevious > 0;
  const tableHeader = isChinese
    ? '| 分类 (Category) | 当前条数 | 当前占比 | 周期变化 (Δ) |\n| :--- | :---: | :---: | :---: |'
    : '| Category | Items | Current Share | Cycle Delta |\n| :--- | :---: | :---: | :---: |';

  const tableRows = stats.categories.map(c => {
    const deltaStr = formatDeltaText(c.delta, hasHistory);
    return `| **${c.name}** | ${c.count} | ${c.share.toFixed(1)}% | \`${deltaStr}\` |`;
  }).join('\n');

  return [
    sectionTitle,
    subtitle,
    '',
    '```chart:category-donut',
    chartPayload,
    '```',
    '',
    tableHeader,
    tableRows,
    '',
  ].join('\n');
}

/**
 * Injects the Category Distribution visualization section strictly between
 * "Today's Highlights" and "Trending Dynamics".
 *
 * Supported heading patterns:
 * - English: `## Today's Highlights` -> `## Trending Dynamics`
 * - Chinese: `## 每日综述` -> `## 热点摘要`
 * - Fallback: `## 今日趋势概览` -> `## 重点趋势`
 *
 * Safe & Idempotent: If the section already exists, it is refreshed in place.
 */
export function injectCategoryDistributionVisualization(
  markdown: string,
  currentItems: TrendSourceItem[] = [],
  historyItems: TrendSourceItem[] = [],
): string {
  if (!markdown) return markdown;

  // Determine language based on existing markdown headers
  const isChinese = /##\s*(每日综述|今日趋势概览|热点摘要|重点趋势)/.test(markdown);

  const stats = calculateCategoryDistribution(currentItems, historyItems);
  const visualBlock = buildCategoryDistributionMarkdown(stats, isChinese);

  // If already contains the category distribution section, replace it in place
  const existingSectionRegex = /##\s*(Category Distribution|分类分布环形图)[\s\S]*?(?=(?:\n##\s+)|$)/i;
  if (existingSectionRegex.test(markdown)) {
    return markdown.replace(existingSectionRegex, visualBlock.trim() + '\n\n');
  }

  // Primary insertion target: immediately before `## Trending Dynamics` (or `## 热点摘要` / `## 重点趋势`)
  // Accommodates variations like "## 2. Trending Dynamics", curly apostrophes, lowercase, etc.
  const trendingDynamicsRegex = /\n(##\s*(?:\d+\.?\s*)?(?:Trending Dynamics|热点摘要|重点趋势)[\s\S]*)$/i;
  const matchTrending = markdown.match(trendingDynamicsRegex);
  if (matchTrending && matchTrending.index != null) {
    const beforeTrending = markdown.slice(0, matchTrending.index);
    const trendingAndRest = markdown.slice(matchTrending.index);
    return `${beforeTrending.trimEnd()}\n\n${visualBlock.trim()}\n\n${trendingAndRest.trimStart()}`;
  }

  // Secondary insertion target: immediately after `## Today's Highlights` (or `## 每日综述` / `## 今日趋势概览`) section
  const highlightsRegex = /(##\s*(?:\d+\.?\s*)?(?:Today['’]s Highlights|每日综述|今日趋势概览)[\s\S]*?)(?=\n##\s+|$)/i;
  const matchHighlights = markdown.match(highlightsRegex);
  if (matchHighlights && matchHighlights.index != null) {
    const insertPos = matchHighlights.index + matchHighlights[0].length;
    const beforePos = markdown.slice(0, insertPos);
    const afterPos = markdown.slice(insertPos);
    return `${beforePos.trimEnd()}\n\n${visualBlock.trim()}\n\n${afterPos.trimStart()}`;
  }

  // Fallback: If neither standard heading exists, append after the first `# ` title or at the beginning
  const titleRegex = /(^#\s+[^\n]+\n+)/;
  if (titleRegex.test(markdown)) {
    return markdown.replace(titleRegex, `$1${visualBlock.trim()}\n\n`);
  }

  return `${visualBlock.trim()}\n\n${markdown}`;
}
