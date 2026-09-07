export const AI_KEYWORDS = [
  'ai',
  'agent',
  'agents',
  'llm',
  'llms',
  'genai',
  'large language model',
  'openai',
  'anthropic',
  'claude',
  'gemini',
  'deepseek',
  'langchain',
  'langgraph',
  'deepagents',
  'multimodal',
  'open source model',
  'inference',
  'rag',
  'vector database',
  'model context protocol',
  'mcp',
  'mcps',
  // Chinese keywords
  '人工智能',
  '大模型',
  '大语言模型',
  '智能体',
  '多模态',
  '开源模型',
  '向量数据库',
  '机器学习',
  '深度学习',
  '生成式',
  'ai agent',
  'ai应用',
  'ai工具',
  '机器之心',
];

export const CATEGORY_KEYWORDS: Record<string, string[]> = {
  'AI Agent': ['agent', 'agents', 'langgraph', 'deepagents', 'mcp', 'mcps', 'tool calling'],
  LLM: ['llm', 'llms', 'large language model', 'openai', 'anthropic', 'claude', 'gemini', 'deepseek'],
  Multimodal: ['multimodal', 'vision', 'audio', 'video', 'image generation'],
  'Open Source Model': ['open source', 'hugging face', 'weights', 'model release'],
  'AI Infra': ['inference', 'gpu', 'vector', 'rag', 'latency', 'serving', 'deployment'],
};

/**
 * Checks if a keyword contains any CJK (Chinese) characters.
 */
export function isChineseKeyword(keyword: string): boolean {
  return /[\u4e00-\u9fa5]/.test(keyword);
}

/**
 * Escapes regex special characters in a string.
 */
export function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Compiles a list of keywords into an optimized matcher function.
 * English words/abbreviations use word boundaries (\b) to avoid substring false positives
 * (such as 'email', 'domain', 'maintain', 'chain' falsely matching 'ai').
 * Chinese keywords use substring matching.
 */
export function createKeywordMatcher(keywords: string[]): (text: string) => boolean {
  const chineseKeywords: string[] = [];
  const englishPatterns: string[] = [];

  for (const raw of keywords) {
    const keyword = raw.trim();
    if (!keyword) continue;

    if (isChineseKeyword(keyword)) {
      chineseKeywords.push(keyword.toLowerCase());
    } else {
      const startBoundary = /^\w/.test(keyword) ? '\\b' : '';
      const endBoundary = /\w$/.test(keyword) ? '\\b' : '';
      englishPatterns.push(`${startBoundary}${escapeRegExp(keyword)}${endBoundary}`);
    }
  }

  let englishRegex: RegExp | null = null;
  if (englishPatterns.length > 0) {
    englishRegex = new RegExp(`(?:${englishPatterns.join('|')})`, 'i');
  }

  return (text: string): boolean => {
    if (!text) return false;
    // Check English word boundary regex
    if (englishRegex && englishRegex.test(text)) {
      return true;
    }
    // Check Chinese substring matches
    if (chineseKeywords.length > 0) {
      const lower = text.toLowerCase();
      return chineseKeywords.some(kw => lower.includes(kw));
    }
    return false;
  };
}

export const isAiContent = createKeywordMatcher(AI_KEYWORDS);

export const extractScript = `
      JSON.stringify(
        Array.from(document.querySelectorAll('a[href*="/p/"]')).slice(0, 40).map(a => {
          const href = a.getAttribute('href') || '';
          if (!href.match(/\\/p\\/\\d/)) return null;
          const titleEl = a.querySelector('h2, h3, h4, [class*="title"], [class*="Title"]') || a;
          const title = (titleEl.textContent || '').replace(/\\s+/g, ' ').trim();
          if (!title || title.length < 6 || title.length > 100) return null;
          const parent = a.closest('div, article, section') || a.parentElement;
          const descEl = parent?.querySelector('p, [class*="desc"], [class*="summary"], [class*="subtitle"]');
          const summary = descEl ? (descEl.textContent || '').trim().slice(0, 150) : '';
          return { title, url: href, summary };
        }).filter(Boolean).filter((item, i, arr) =>
          arr.findIndex(x => x.url === item.url) === i
        ).slice(0, 20)
      );
    `;

