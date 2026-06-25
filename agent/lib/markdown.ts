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
