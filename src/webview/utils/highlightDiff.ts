import { getHighlighter, getShikiTheme, normalizeLanguage } from '@/composables/useShikiHighlighter';
import type { DiffLine } from './parseUnifiedDiff';
import { escapeHtml } from './stringUtils';

export interface HighlightedDiffLine extends DiffLine {
  highlightedContent: string;
}

const MAX_HIGHLIGHT_LINES = 1000;

export async function highlightDiffLines(
  lines: DiffLine[],
  language: string
): Promise<HighlightedDiffLine[]> {
  if (lines.length > MAX_HIGHLIGHT_LINES || lines.length === 0) {
    return lines.map((line) => ({
      ...line,
      highlightedContent: escapeHtml(line.content),
    }));
  }

  try {
    const normalizedLang = normalizeLanguage(language);
    const highlighter = await getHighlighter(normalizedLang);
    const theme = getShikiTheme();

    const contentLines = lines
      .filter((l) => l.type !== 'gap')
      .map((l) => l.content);

    if (contentLines.length === 0) {
      return lines.map((line) => ({
        ...line,
        highlightedContent: escapeHtml(line.content),
      }));
    }

    const fullCode = contentLines.join('\n');
    const html = highlighter.codeToHtml(fullCode, {
      lang: normalizedLang,
      theme,
      transformers: [
        {
          pre(node) {
            node.properties.style = 'padding:0;margin:0;background:transparent;';
            return node;
          },
        },
      ],
    });

    const highlightedLines = extractLinesFromHtml(html);
    let highlightIdx = 0;

    return lines.map((line) => {
      if (line.type === 'gap') {
        return { ...line, highlightedContent: '' };
      }
      const highlighted = highlightedLines[highlightIdx++] || escapeHtml(line.content);
      return { ...line, highlightedContent: highlighted };
    });
  } catch (error) {
    console.error('[highlightDiff] Failed to highlight:', error);
    return lines.map((line) => ({
      ...line,
      highlightedContent: escapeHtml(line.content),
    }));
  }
}

function extractLinesFromHtml(html: string): string[] {
  const codeMatch = html.match(/<code[^>]*>([\s\S]*?)<\/code>/);
  if (!codeMatch) return [];

  const codeContent = codeMatch[1];
  const lines: string[] = [];
  const lineRegex = /<span class="line">([\s\S]*?)<\/span>(?=<span class="line">|$)/g;
  let match;

  while ((match = lineRegex.exec(codeContent)) !== null) {
    lines.push(match[1]);
  }

  if (lines.length === 0) {
    return codeContent.split('\n');
  }

  return lines;
}
