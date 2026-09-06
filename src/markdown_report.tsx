import type { ReactNode } from 'react';
import styles from './trends_dashboard.module.css';
import CategoryDonutChart, { type CategoryDistributionData } from './category_donut_chart';

interface MarkdownReportProps {
  markdown: string;
}

/**
 * Parse inline markdown: **bold**, `code`, [link](url), and plain text.
 * Handles multiple links, code snippets, and bold segments within a single line.
 */
function renderInline(text: string): ReactNode {
  const tokens = text.split(/(\*\*.+?\*\*|`[^`]+`|\[.+?\]\(.+?\))/g).filter(Boolean);
  return tokens.map((token, i) => {
    // Bold
    if (token.startsWith('**') && token.endsWith('**')) {
      return <strong key={i}>{token.slice(2, -2)}</strong>;
    }
    // Code
    if (token.startsWith('`') && token.endsWith('`')) {
      return <code key={i} className={styles.inlineCode}>{token.slice(1, -1)}</code>;
    }
    // Link
    const linkMatch = token.match(/^\[(.+?)\]\((.+?)\)$/);
    if (linkMatch) {
      return <a key={i} href={linkMatch[2]} target="_blank" rel="noreferrer">{linkMatch[1]}</a>;
    }
    // Plain text
    return <span key={i}>{token}</span>;
  });
}

type ParsedBlock =
  | { type: 'chart'; data: CategoryDistributionData }
  | { type: 'table'; headers: string[]; rows: string[][] }
  | { type: 'h1'; text: string }
  | { type: 'h2'; text: string }
  | { type: 'h3'; text: string }
  | { type: 'meta'; label: string; value: string }
  | { type: 'overview'; index: string; title: string; desc?: string }
  | { type: 'listItem'; text: string }
  | { type: 'quote'; text: string }
  | { type: 'hr' }
  | { type: 'spacer' }
  | { type: 'p'; text: string };

/**
 * Parses markdown lines into structured semantic blocks, recognizing code blocks,
 * category donut charts, tables, quotes, and standard markdown elements.
 */
function parseMarkdownBlocks(markdown: string): ParsedBlock[] {
  const lines = markdown.split('\n');
  const blocks: ParsedBlock[] = [];

  let i = 0;
  while (i < lines.length) {
    const rawLine = lines[i];
    const line = rawLine.trim();

    // 1. Code blocks (e.g. ```chart:category-donut ... ```)
    if (line.startsWith('```')) {
      const tag = line.slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // Skip closing ```

      if (tag === 'chart:category-donut' || tag === 'category-donut') {
        try {
          const parsed = JSON.parse(codeLines.join('\n')) as CategoryDistributionData;
          if (parsed && Array.isArray(parsed.categories)) {
            blocks.push({ type: 'chart', data: parsed });
            continue;
          }
        } catch {
          // In case of incomplete JSON during streaming, ignore or fallback
        }
      }
      continue;
    }

    // 2. Tables (lines starting and ending with |)
    if (line.startsWith('|') && line.endsWith('|')) {
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('|') && lines[i].trim().endsWith('|')) {
        tableLines.push(lines[i].trim());
        i++;
      }

      if (tableLines.length >= 2) {
        const splitRow = (rowStr: string) =>
          rowStr
            .slice(1, -1)
            .split('|')
            .map(c => c.trim());

        const headers = splitRow(tableLines[0]);
        // line 1 is separator |:---|:---:|
        const rows = tableLines.slice(2).map(splitRow);
        blocks.push({ type: 'table', headers, rows });
        continue;
      }
    }

    // 3. Empty lines
    if (!line) {
      blocks.push({ type: 'spacer' });
      i++;
      continue;
    }

    // 4. Headings
    if (line.startsWith('# ')) {
      blocks.push({ type: 'h1', text: line.slice(2) });
      i++;
      continue;
    }
    if (line.startsWith('## ')) {
      blocks.push({ type: 'h2', text: line.slice(3) });
      i++;
      continue;
    }
    if (line.startsWith('### ')) {
      blocks.push({ type: 'h3', text: line.slice(4) });
      i++;
      continue;
    }

    // 5. Blockquote
    if (line.startsWith('> ')) {
      blocks.push({ type: 'quote', text: line.slice(2) });
      i++;
      continue;
    }

    // 6. Meta rows (生成时间：... / 分析内容：...)
    if (line.startsWith('生成时间：') || line.startsWith('分析内容：')) {
      const [label, ...rest] = line.split('：');
      blocks.push({ type: 'meta', label, value: rest.join('：') });
      i++;
      continue;
    }

    // 7. Numbered items: "1. **Title**：description"
    const overviewMatch = line.match(/^(\d+)\.\s+\*\*(.+?)\*\*[：:.]?\s*(.*)$/);
    if (overviewMatch) {
      blocks.push({
        type: 'overview',
        index: overviewMatch[1],
        title: overviewMatch[2],
        desc: overviewMatch[3] || undefined,
      });
      i++;
      continue;
    }

    // 8. Numbered items with links or plain: "1. [Title](url) — description"
    const numberedMatch = line.match(/^(\d+)\.\s+(.+)$/);
    if (numberedMatch) {
      blocks.push({
        type: 'overview',
        index: numberedMatch[1],
        title: numberedMatch[2],
      });
      i++;
      continue;
    }

    // 9. Unordered list item
    if (line.startsWith('- ')) {
      blocks.push({ type: 'listItem', text: line.slice(2) });
      i++;
      continue;
    }

    // 10. Horizontal divider
    if (/^[-*_]{3,}$/.test(line)) {
      blocks.push({ type: 'hr' });
      i++;
      continue;
    }

    // 11. Paragraph
    blocks.push({ type: 'p', text: line });
    i++;
  }

  return blocks;
}

export default function MarkdownReport({ markdown }: MarkdownReportProps) {
  const blocks = parseMarkdownBlocks(markdown);

  return (
    <article className={styles.markdown}>
      {blocks.map((block, index) => {
        switch (block.type) {
          case 'chart':
            return <CategoryDonutChart key={index} data={block.data} />;

          case 'table':
            return (
              <div key={index} className={styles.tableWrapper}>
                <table className={styles.reportTable}>
                  <thead>
                    <tr>
                      {block.headers.map((header, hIdx) => (
                        <th key={hIdx}>{renderInline(header)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {block.rows.map((row, rIdx) => (
                      <tr key={rIdx}>
                        {row.map((cell, cIdx) => (
                          <td key={cIdx}>{renderInline(cell)}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );

          case 'h1':
            return <h1 key={index}>{block.text}</h1>;

          case 'h2':
            return <h2 key={index}>{block.text}</h2>;

          case 'h3':
            return <h3 key={index}>{block.text}</h3>;

          case 'quote':
            return (
              <blockquote key={index} className={styles.reportQuote}>
                {renderInline(block.text)}
              </blockquote>
            );

          case 'meta':
            return (
              <div key={index} className={styles.reportMetaRow}>
                <span>{block.label}</span>
                <strong>{block.value}</strong>
              </div>
            );

          case 'overview':
            return (
              <div key={index} className={styles.overviewItem}>
                <span className={styles.overviewIndex}>{block.index}</span>
                <div>
                  <strong>{renderInline(block.title)}</strong>
                  {block.desc && <p>{renderInline(block.desc)}</p>}
                </div>
              </div>
            );

          case 'listItem':
            return (
              <li key={index} className={styles.reportListItem}>
                {renderInline(block.text)}
              </li>
            );

          case 'hr':
            return <hr key={index} className={styles.reportDivider} />;

          case 'spacer':
            return <div key={index} className={styles.reportSpacer} />;

          case 'p':
          default:
            return <p key={index}>{renderInline(block.text)}</p>;
        }
      })}
    </article>
  );
}
