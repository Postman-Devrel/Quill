import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Sections in the SKILL.md files that are Claude Code-specific (file reads,
// tool calls, dashboard writes). These must be stripped before using the
// SKILL.md as a direct Anthropic API system prompt.
const SKIP_SECTIONS = [
  'Input Handling',
  'Writing Style Guide',
  'Research Phase',
  'Post-Write',
  'Behavior Modes',
  // blog-ideas specific steps that use Write/WebSearch tools
  'Step 1: Gather Trending Topics',
  'Step 2: Analyze Postman.com Content Gaps',
  'Step 5: Save Output',
  'Step 6: Persist Ideas to Dashboard',
];

function stripFrontmatter(text: string): string {
  if (!text.startsWith('---')) return text;
  const end = text.indexOf('---', 3);
  return end === -1 ? text : text.slice(end + 3).trimStart();
}

// After stripping, some SKILL.md sections still point at companion files with a
// "Read `resources/foo.md`" directive (e.g. blog-write offloads its post-types
// and final-checklist to resources/). Claude Code follows those reads at runtime;
// the API agent can't, so we inline the referenced file's contents here. This
// lets the SKILL.md stay byte-identical to the Claude Code plugin version while
// still delivering the full guidance to the model.
//
// Only "Read `path`" directives are resolved. Bare mentions ("Using the patterns
// catalogued in `...humanizer.md`") are left alone on purpose — humanizer.md is
// delivered separately via HUMANIZER_BLOCK in prompts/style-guide.ts, and its
// own reads live in the (stripped) Writing Style Guide section, so it never
// double-injects here.
function inlineResourceReads(text: string, skillName: string, skillsRoot: string): string {
  const readDirective = /read\s+`([\w./-]+\.md)`/i;
  return text
    .split('\n')
    .map((line) => {
      const m = line.match(readDirective);
      if (!m) return line;
      const ref = m[1];
      if (!ref.includes('resources/')) return line;
      const filePath = ref.startsWith('skills/')
        ? join(skillsRoot, ref) // e.g. skills/blog-write/resources/foo.md
        : join(skillsRoot, skillName, ref); // e.g. resources/foo.md, relative to this skill
      try {
        const content = readFileSync(filePath, 'utf8').trim();
        // Drop a leading top-level "# Heading" so it doesn't collide with the
        // "## Section" heading that already precedes the Read directive.
        return content.replace(/^#\s+.*\n+/, '');
      } catch {
        return line; // file missing — leave the directive rather than blanking guidance
      }
    })
    .join('\n');
}

function stripClaudeCodeSections(text: string): string {
  const lines = text.split('\n');
  const out: string[] = [];
  let skipping = false;
  let skipDepth = 0;

  for (const line of lines) {
    const headingMatch = line.match(/^(#{1,4})\s+(.+)/);
    if (headingMatch) {
      const depth = headingMatch[1].length;
      const title = headingMatch[2].trim();
      const shouldSkip = SKIP_SECTIONS.some((s) => title.includes(s));

      if (shouldSkip) {
        skipping = true;
        skipDepth = depth;
        continue;
      }

      if (skipping && depth <= skipDepth) {
        skipping = false;
      }
    }

    if (!skipping) out.push(line);
  }

  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

const cache = new Map<string, string>();

export function readSkillMd(skillName: string): string {
  if (cache.has(skillName)) return cache.get(skillName)!;

  const skillsRoot = join(process.cwd(), 'skills');
  const filePath = join(skillsRoot, skillName, 'SKILL.md');

  let raw: string;
  try {
    raw = readFileSync(filePath, 'utf8');
  } catch (e) {
    throw new Error(
      `Could not read skills/${skillName}/SKILL.md: ${e instanceof Error ? e.message : String(e)}. ` +
        `Make sure the skills/ folder is present in the working directory.`,
    );
  }

  const stripped = stripClaudeCodeSections(stripFrontmatter(raw));
  const cleaned = inlineResourceReads(stripped, skillName, skillsRoot);
  cache.set(skillName, cleaned);
  console.log(`[skill-md] loaded ${skillName} (${cleaned.length} chars after strip)`);
  return cleaned;
}
