# Quill — Build Learnings

Lessons learned while building the Quill blog pipeline agent on Astropods + Mastra.

---

## Platform & Infrastructure

### Mastra default `maxSteps` is 5 — way too low
Mastra's agentic loop defaults to 5 steps per execution. A single Quill workflow (write → save to Confluence → create Jira ticket → stage to WP) already uses 4+ steps. Blog ideas with parallel research uses 12+. Always set a higher limit.

**Fix:** Proxy the agent before passing it to `MastraAdapter` to inject `maxSteps` on every `stream()` call:
```ts
const agentWithMaxSteps = new Proxy(agent, {
  get(target, prop) {
    if (prop === 'stream') {
      return (messages, options = {}) =>
        target.stream(messages, { ...options, maxSteps: 25 });
    }
    const value = target[prop];
    return typeof value === 'function' ? value.bind(target) : value;
  },
});
serve(new MastraAdapter(agentWithMaxSteps));
```

### Proxy + private class fields: always bind to the original target
A naive `Proxy` that returns `target[prop]` unbound causes `TypeError: Cannot access invalid private field` when the class uses private fields (`#instructions`, etc.). The fix is to bind every function to the original `target`, not the proxy.

### `MastraAdapter` doesn't expose `maxSteps`
`MastraAdapter.stream()` calls `agent.stream(prompt, { memory, tracingOptions })` — no `maxSteps`. There's no constructor option either. The proxy pattern above is the only clean workaround without patching the adapter package.

### Hot-reload vs. rebuild
- `bun --watch` hot-reloads TypeScript file changes automatically — no restart needed.
- Changes to `astropods.yml` or new npm dependencies require `ast project start --rebuild`.

### `ast project configure` vs. `.env`
Two separate credential stores exist:
- `ast project configure` — persistent store at `~/.ast/project-configs.json`, loaded automatically by `ast project start`.
- `.env` file — loaded alongside configure; **empty entries in `.env` override the configure store with blank strings**.

Keep `.env` clean (comments only or genuinely local overrides). Store all secrets in `ast project configure`.

Inspect stored keys safely (without exposing values):
```bash
ast project configure -o json | python3 -c "import sys,json; print(list(json.load(sys.stdin).keys()))"
```

### Appending to `.env` without a trailing newline corrupts it
`echo "KEY=value" >> .env` merges the new line onto the last line if the file has no trailing newline. Always verify with `grep -c "^KEY" .env` after appending.

---

## Prompt Engineering

### Claude Code SKILL.md files are NOT portable to the Anthropic API
The `.md` skill files in `devrel-claude-code-skills` are designed for the Claude Code CLI. They contain instructions to use Claude Code tools (`WebSearch`, `WebFetch`, `Read`, `Write`). When used as a raw system prompt in an API call, Claude tries to output those tool calls as XML, which breaks any JSON parser downstream.

**Fix:** Copy SKILL.md files locally, strip Claude Code-specific sections, and inject Quill-specific output format requirements on top. See `agent/lib/skill-md.ts`.

### Sections to strip from SKILL.md before API use
| Section | Why it's unsafe |
|---|---|
| Input Handling | Reads local files via `Read` tool |
| Writing Style Guide | Reads local style-guide `.md` files |
| Research Phase | Calls `WebSearch` and `WebFetch` |
| Step 5/6 (blog-ideas) | Writes output to disk via `Write` |
| Behavior Modes (copyedit) | References Claude Code hook system |
| Post-Write | References the auto-run hook |

### JSON output tools need an explicit "no tool calls" instruction
Even with a JSON output format specified, Claude can still try to output tool calls if the system prompt references tools. Always add: `"Return ONLY the JSON object. No tool calls, no file writes, no explanations."` to any tool that expects pure JSON.

### Quill output format must override SKILL.md output format
The SKILL.md files define their own output formats (markdown reports, dashboard writes). Always prepend Quill's JSON schema before injecting the SKILL.md content so the output format instruction takes precedence.

### Keep hardcoded output schemas, pull voice/style from skills
The right split:
- **Hardcoded in Quill:** output format (JSON schema), field names, strict output rules
- **From SKILL.md:** voice, tone, content structure, SEO rules, expertise guidelines, scoring rubrics

---

## Performance

### Anthropic prompt caching cuts time-to-first-token significantly
Large system prompts (like the stripped SKILL.md content) are expensive to process on every call. Adding `cache_control: { type: "ephemeral" }` to the system prompt tells Anthropic to cache it for 5 minutes. Repeated calls in the same session are dramatically faster.

```ts
system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }]
```

### Right-size `maxTokens` per tool
Don't use 8000 for everything — Claude generates up to the limit you give it.

| Tool | Appropriate maxTokens | Reasoning |
|---|---|---|
| `write_draft` | 3500 | 1200–1600 word post + frontmatter |
| `copyedit_draft` | 5000 | Full edited draft + JSON wrapper |
| `blog_ideas` | 2500 | JSON array of 8–12 scored ideas |

### Use a faster model for structured JSON scoring
`blog_ideas` is pure scoring and ranking — it doesn't need Opus-level reasoning. `claude-haiku-4-5` is 5–10× faster and sufficient for the task. Reserve Opus for `write_draft` and `copyedit_draft` where quality matters most.

### Lower temperature for JSON outputs
JSON tools benefit from lower temperature (less random = more reliably valid JSON):
- `copyedit_draft`: `temperature: 0.3`
- `blog_ideas`: `temperature: 0.5`
- `write_draft`: keep default (creativity wanted)

---

## Output Formatting

### Slack mrkdwn ≠ standard markdown
Slack uses its own `mrkdwn` syntax (`*bold*`, `_italic_`, `<url|link text>`). The Astro web playground renders standard markdown (`**bold**`, `[text](url)`). These are incompatible. Quill's instructions target Slack mrkdwn since that's the production surface.

### Don't dump full draft markdown in chat
Pasting 1500-word markdown drafts into a Slack message is hard to read. Instead:
- Show a structured summary (title, meta, section outline, opening paragraph)
- Save the full draft to Confluence and share the link
- The agent can still retrieve the full draft from conversation memory for downstream tool calls (staging to WP, etc.)

### Copy-edit creates a separate Confluence page (not an edit of the original)
`save_to_confluence` is called twice in the write → copyedit flow — once with `suggested_title` (raw draft) and once with `seoTitle` (edited version). These become two independent pages in Confluence, which is intentional: you keep both the original and the edited version.

---

## Architecture Decisions

### Google Drive → Confluence
Google Drive integration was removed early. Folder sharing and file quality issues made it unreliable. Confluence (via Atlassian API) gives the team a shared, searchable draft space. One shared service-account identity owns all pages.

### One Atlassian token for both Confluence and Jira
A single `CONFLUENCE_API_TOKEN` (from a service account) authenticates both Confluence page creation and Jira ticket creation. Fewer secrets, simpler onboarding.

### WordPress is staging-only
Quill stages posts as `status: draft` — it never publishes or schedules. A human editor must set the publish date in WP admin. This was a deliberate scope decision to keep the human in the loop on timing.

### Confluence parent page is hardcoded, not an env var
The Confluence destination space and parent page ID are constants in `agent/lib/confluence.ts`. They're not exposed as `astropods.yml` inputs because the deployed agent should work out-of-the-box without extra configuration. Change the code + redeploy if the destination changes.

### Skills live inside Quill, not fetched from GitHub at runtime
Fetching SKILL.md from GitHub at runtime requires a PAT, adds network latency, and (more importantly) the SKILL.md files need preprocessing before they're API-safe. Copying the relevant skills into `Quill/skills/` and reading them from disk is simpler, faster, and works offline. Update by copying the latest SKILL.md into the folder.

---

## Tooling

### 12 tools, three make dedicated Claude calls
| Tool | LLM | Notes |
|---|---|---|
| `web_search` | ❌ | Tavily |
| `check_blog_coverage` | ❌ | WP search before writing |
| `write_draft` | ✅ Opus | Full draft + frontmatter |
| `copyedit_draft` | ✅ Opus | JSON with editedDraft + changes + flags |
| `blog_ideas` | ✅ Haiku | JSON scoring only |
| `save_to_confluence` | ❌ | Atlassian REST |
| `read_confluence` | ❌ | Atlassian REST |
| `create_header_request` | ❌ | Jira REST |
| `stage_to_wordpress` | ❌ | WP REST, always `status=draft` |
| `find_next_wp_slot` | ❌ | In-process scheduling logic |
| `list_wp_schedule` | ❌ | WP REST |
| `wp_publish_stats` | ❌ | WP REST |

### Always check coverage before writing
`check_blog_coverage` runs a WP search across published, scheduled, draft, and pending posts before `write_draft`. This prevents duplicating content that's already live or in-flight. The agent surfaces matches and asks for confirmation before drafting.

### Skip research by default
Running 3–5 parallel web searches before every draft adds 5–10 seconds of latency. Quill skips research unless the user explicitly asks for it ("research X first, then write"). The model's training knowledge is sufficient for most topics.
