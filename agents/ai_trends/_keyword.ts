export const AI_KEYWORDS = [
  'ai',
  'agent',
  'agents',
  'llm',
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
];

export const CATEGORY_KEYWORDS: Record<string, string[]> = {
  'AI Agent': ['agent', 'agents', 'langgraph', 'deepagents', 'mcp', 'tool calling'],
  LLM: ['llm', 'large language model', 'openai', 'anthropic', 'claude', 'gemini', 'deepseek'],
  Multimodal: ['multimodal', 'vision', 'audio', 'video', 'image generation'],
  'Open Source Model': ['open source', 'hugging face', 'weights', 'model release'],
  'AI Infra': ['inference', 'gpu', 'vector', 'rag', 'latency', 'serving', 'deployment'],
};

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
