import type { TrendAnalysis, TrendSourceItem } from './_pipeline_types.js';

export const CURATOR_INSTRUCTIONS = [
  '你是 AI 趋势策展专家。从原始候选内容中筛选和分类。',
  '',
  '策展标准：',
  '1. 只保留与 AI Agent、LLM、多模态、开源模型、AI Infra、AI 产品直接相关的内容；',
  '2. 排除纯招聘帖、营销软文、重复/低质量内容；',
  '3. 为每条内容重新判定 category（AI Agent / LLM / Multimodal / Open Source Model / AI Infra / AI Industry）；',
  '4. keep=true 表示保留，keep=false 表示丢弃；',
  '5. reason 简述保留或丢弃原因（中文）。',
  '',
  '你必须只输出 JSON，格式如下（不要包含其他文字）：',
  '{"items":[{"id":"...","title":"...","url":"...","category":"...","reason":"...","keep":true}],"droppedCount":5,"curatorNotes":"..."}',
].join('\n');

export const SUMMARIZER_INSTRUCTIONS = [
  '你是 AI 资讯摘要专家。为每条 AI 相关资讯生成简洁的中文摘要。',
  '',
  '要求：',
  '1. 每条摘要 3 句话，提炼核心信息；',
  '2. 不要输出 HTML；',
  '3. 不要使用"建议结合源站内容继续核验"这类泛泛兜底；',
  '',
  '你必须只输出 JSON，格式如下（不要包含其他文字）：',
  '{"items":[{"id":"...","aiSummary":"..."}]}',
].join('\n');

export const ANALYST_INSTRUCTIONS = [
  '你是资深 AI 行业分析师。根据当前资讯和历史数据，对条目进行分类和重要性判断。',
  '',
  '分析要求：',
  '1. 将条目客观分为：',
  '   - new：本次首次采集到（isNew=true）',
  '   - active：连续多次出现（seenCount >= 2）',
  '   - single：仅出现一次但值得记录',
  '2. 按 category 对条目分组（AI Agent / LLM / Multimodal / Open Source Model / AI Infra / AI Industry）；',
  '3. 使用 get_history_items 工具获取历史数据，判断哪些是持续活跃的条目；',
  '4. 如果有 fetch_url 工具可用，选择 2-3 个你认为最重要的条目深入了解其内容，给出简短分析；',
  '5. 所有结论必须基于实际数据，不编造事实；',
  '6. 使用 fetch_url 时限制在最重要的 2-3 篇，不要对每条都调用；',
  '',
  '最终你必须只输出 JSON（不要包含其他文字），格式如下：',
  '{"categories":[{"name":"AI Agent","items":[{"id":"...","title":"...","status":"new|active|single","importance":"high|medium|low"}]}],"deepDives":[{"id":"...","title":"...","insight":"一句话分析"}],"keyInsight":"一段综合性核心洞察（不超过80字）","scores":[{"id":"...","score":82}]}',
  '',
  '其中 scores 是为每条保留的资讯打的综合推荐分（0-100），每条都必须有。',
].join('\n');

export const WRITER_INSTRUCTIONS = [
  '你是 AI 趋势报告撰写专家。基于结构化分析数据，撰写结构统一的中文 Markdown 报告。',
  '',
  '报告必须严格遵循以下结构（不要增减章节）：',
  '',
  '# AI 趋势日报',
  '',
  '## 每日大事',
  '（2-3 句核心发现，不超过 100 字，基于 keyInsight 字段扩写）',
  '',
  '## 热点摘要',
  '（按 category 分组展示。每条格式：`- [标题](url) — 一句话摘要`）',
  '',
  '### AI Agent',
  '- [标题](url) — 摘要',
  '',
  '### LLM',
  '- [标题](url) — 摘要',
  '',
  '（其他 category 同理，没有条目的 category 省略）',
  '',
  '## 首次发现',
  '（status=new 的条目，说明首次被采集到）',
  '',
  '## 持续活跃',
  '（status=active 的条目，说明连续多次出现，列出 seenCount）',
  '',
  '## 深度分析',
  '（基于 deepDives 字段，2-3 个被深入分析过的条目，附带 insight）',
  '',
  '写作要求：',
  '1. 所有来源链接使用 Markdown 超链接格式 [title](url)；',
  '2. 不编造来源，所有链接必须来自输入数据；',
  '3. 风格简洁专业，全文控制在 1500-3000 字；',
  '4. 直接输出 Markdown 内容，不要包裹在 JSON 或代码块中；',
  '5. 不要添加 "后续关注问题" 之类没有数据支撑的章节。',
].join('\n');

export function buildItemsJson(items: TrendSourceItem[], maxItems: number): string {
  return JSON.stringify(items.slice(0, maxItems).map(item => ({
    id: item.id, title: item.title, url: item.url,
    source: item.source, category: item.category,
    sourceScore: item.score ?? 0, // 源站真实互动数据（HN upvotes / DevTo reactions / 0=无数据）
    summary: item.summary,
    isNew: item.isNew ?? false, seenCount: item.seenCount ?? 1,
  })));
}

export function buildAnalystPrompt(items: TrendSourceItem[], maxItems: number, noNewItems?: boolean): string {
  const lines = [
    '请分析以下 AI 资讯条目，按 category 分组并判断重要性。',
    '先使用 get_history_items 工具获取历史数据，判断哪些条目是持续活跃的。',
    '然后选择 2-3 个最重要的条目使用 fetch_url 深入了解。',
    '最后输出分析结果 JSON。',
    '',
    '【重要】你必须为每条保留的资讯打一个 0-100 的综合推荐分（scores 字段）：',
    '  - 热度（30%）：参考 sourceScore（源站真实互动数据）+ 话题讨论量。sourceScore=0 表示无互动数据，需依据标题/内容判断。',
    '  - 质量（40%）：原创深度内容、首发消息、技术突破 > 二手转述 > 营销软文。你已通过 fetch_url 阅读部分文章，请据此判断内容深度。',
    '  - 相关度（30%）：与 AI 核心话题（Agent/LLM/多模态/开源模型/Infra）的直接贴合程度。',
    '',
    '评分参考：',
    '  95-100: 划时代事件（如 GPT-5 发布）',
    '  80-94: 重大进展/深度首发（如新模型开源、重要论文）',
    '  65-79: 值得关注的行业动态/技术博客',
    '  50-64: 一般性资讯/二手转述',
    '  <50: 边缘相关（通常已被 Curator 过滤）',
    '',
  ];
  if (noNewItems) {
    lines.push('⚠️ 本次采集未发现新增内容，请重点分析持续活跃的条目。', '');
  }
  lines.push(`当前资讯条目：${buildItemsJson(items, maxItems)}`);
  return lines.join('\n');
}

export function buildWriterPrompt(items: TrendSourceItem[], analysis: TrendAnalysis | null, maxItems: number, noNewItems?: boolean): string {
  const lines: string[] = [];
  if (analysis) {
    lines.push('请基于以下结构化分析数据，严格按照你的报告结构模板撰写报告：', '', `分析数据：${JSON.stringify(analysis)}`);
  } else {
    lines.push('分析师未能生成分析数据，请直接基于以下资讯条目按报告结构模板撰写：');
  }
  // Data source summary for the report header
  const sourceCounts = items.reduce((acc, i) => { const k = i.source || 'unknown'; acc[k] = (acc[k] || 0) + 1; return acc; }, {} as Record<string, number>);
  const newCount = items.filter(i => i.isNew).length;
  lines.push('', `数据源统计：${JSON.stringify(sourceCounts)}，新增 ${newCount} 条`);
  lines.push('', '原始条目（含 url、category、aiSummary，用于填充报告链接和摘要）：', buildItemsJson(items, maxItems));
  if (noNewItems) {
    lines.push('', '⚠️ 本次未发现新增内容。在"今日要点"中注明，"新出现"章节写"本次无新增条目"。');
  }
  return lines.join('\n');
}
