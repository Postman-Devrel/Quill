import { marked } from 'marked';
import YAML from 'yaml';

export interface ParsedFrontmatter {
  frontmatter: Record<string, unknown>;
  body: string;
}

/**
 * Split a markdown document into its YAML frontmatter and body.
 * If no frontmatter is present, returns an empty frontmatter object and the
 * original markdown as the body.
 */
export function parseFrontmatter(markdown: string): ParsedFrontmatter {
  const trimmed = markdown.replace(/^﻿/, ''); // strip BOM
  if (!trimmed.startsWith('---')) {
    return { frontmatter: {}, body: markdown };
  }

  const end = trimmed.indexOf('\n---', 3);
  if (end === -1) {
    return { frontmatter: {}, body: markdown };
  }

  const yamlText = trimmed.slice(3, end).trim();
  const body = trimmed.slice(end + 4).trim();

  let frontmatter: Record<string, unknown> = {};
  try {
    const parsed = YAML.parse(yamlText);
    if (parsed && typeof parsed === 'object') {
      frontmatter = parsed as Record<string, unknown>;
    }
  } catch {
    // Malformed YAML — fall through with empty frontmatter
  }

  return { frontmatter, body };
}

/**
 * Convert a markdown body (no frontmatter) into HTML suitable for WordPress
 * or Drive upload. Uses GitHub-flavored markdown.
 */
export async function markdownToHtml(body: string): Promise<string> {
  return marked.parse(body, { gfm: true }) as Promise<string>;
}

/**
 * Remove a single leading H1 (the title line, `# ...`) from a markdown body.
 *
 * Draft bodies from write_draft/copyedit_draft open with `# {title}`, but
 * WordPress renders the post title from its own `title` field — leaving the H1
 * in the body duplicates the title on the published page. Only strips an H1 at
 * the very top (before any other content); H2+ and any later `#` headings are
 * left untouched.
 */
export function stripLeadingH1(body: string): string {
  const lines = body.split('\n');
  let i = 0;
  while (i < lines.length && lines[i].trim() === '') i++; // skip leading blank lines
  // A single `#` followed by whitespace = H1 (`## ` etc. won't match).
  if (i < lines.length && /^#\s+\S/.test(lines[i])) {
    lines.splice(0, i + 1); // drop blanks + the H1 line
    while (lines.length && lines[0].trim() === '') lines.shift(); // drop trailing blanks
    return lines.join('\n');
  }
  return body;
}

/**
 * Pull a string-typed frontmatter field, with a fallback.
 */
export function frontmatterString(
  fm: Record<string, unknown>,
  key: string,
  fallback = '',
): string {
  const v = fm[key];
  return typeof v === 'string' ? v : fallback;
}

/**
 * Pull a number-typed frontmatter field (e.g. `wordpress_id`). Accepts a real
 * number or a numeric string. Returns undefined when absent or unparseable.
 */
export function frontmatterNumber(
  fm: Record<string, unknown>,
  key: string,
): number | undefined {
  const v = fm[key];
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) {
    return Number(v);
  }
  return undefined;
}

/**
 * Pull a string-array frontmatter field (handles both `["a","b"]` and YAML list form).
 */
export function frontmatterStringArray(
  fm: Record<string, unknown>,
  key: string,
): string[] {
  const v = fm[key];
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === 'string');
}
