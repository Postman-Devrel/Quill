import {
  HYBRID_VOICE_BLOCK,
  RUNNABLE_CODE_BLOCK,
  BANNED_WORDS_BLOCK,
} from './style-guide.js';

// The writer's core system prompt is sourced from the shared Postman DevRel
// skills repo so a single SKILL.md file is the source of truth across every
// tool that writes blogs. Updates to that file propagate to the deployed
// Quill agent on the next fetch (TTL below) — no redeploy required.
//
// Requires GITHUB_SKILLS_TOKEN (fine-grained PAT with Contents:read on the
// skills repo). Set via `ast secrets create GITHUB_SKILLS_TOKEN`.
const SKILL_MD_URL =
  'https://raw.githubusercontent.com/Postman-Devrel/devrel-claude-code-skills/main/skills/blog-write/SKILL.md';
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

let cachedSkill: { text: string; fetchedAt: number } | null = null;

async function fetchSkillMd(): Promise<string> {
  const now = Date.now();
  if (cachedSkill && now - cachedSkill.fetchedAt < CACHE_TTL_MS) {
    return cachedSkill.text;
  }

  const token = process.env.GITHUB_SKILLS_TOKEN;
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;

  try {
    const resp = await fetch(SKILL_MD_URL, { headers });
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status} ${resp.statusText}`);
    }
    const text = await resp.text();
    cachedSkill = { text, fetchedAt: now };
    console.log(`[blog-write] fetched SKILL.md (${text.length} chars)`);
    return text;
  } catch (e) {
    if (cachedSkill) {
      console.warn(
        `[blog-write] SKILL.md refetch failed, using stale cache (${Math.round(
          (Date.now() - cachedSkill.fetchedAt) / 1000,
        )}s old): ${e instanceof Error ? e.message : String(e)}`,
      );
      return cachedSkill.text;
    }
    throw new Error(
      `Failed to fetch blog-write SKILL.md and no cache is available. ` +
        `If the skills repo is private, GITHUB_SKILLS_TOKEN must be set to a ` +
        `fine-grained PAT with Contents:read on Postman-Devrel/devrel-claude-code-skills. ` +
        `Original error: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

export async function getBlogWriteSystemPrompt(): Promise<string> {
  const skillMd = await fetchSkillMd();
  return `${skillMd}

---

# Postman DevRel style-guide (loaded alongside the skill above — these rules take precedence when in conflict)

${HYBRID_VOICE_BLOCK}

${RUNNABLE_CODE_BLOCK}

${BANNED_WORDS_BLOCK}`;
}
