---
name: Quill
description: Slack-first blog pipeline agent for Postman DevRel. Drop a topic and Quill researches, drafts, copy-edits, saves to Confluence, and stages to WordPress as a draft — a human editor still schedules and publishes.
tags: [blog, content, devrel, writing, wordpress, confluence, publishing, slack]
authors: [pmmistry]
---

# Quill 🪶

> *From idea to live post, without leaving Slack.*

Quill is the Postman DevRel team's content-pipeline agent for [blog.postman.com](https://blog.postman.com), accessible from Slack on the Astropods platform. It collapses what used to be a multi-tool workflow into a single conversation: research, content-gap check, full draft generation in Postman's voice, copy-editing for grammar / style guide / SEO, automatic Confluence saves for every draft and edit, and WordPress staging with auto-resolved tags and Yoast metadata. **Quill is staging-only** — it creates WordPress drafts but never publishes; a human editor schedules and publishes from the WP admin panel. Quill can surface the next open Tue/Thu 8am-PT publish slots (with US holiday exclusions and same-day conflict detection) as guidance.

Quill also reads existing Confluence pages, so you can drop a page link and ask for a copy-edit, a fresh blog post built from it, or a brainstorm of related ideas.

---

## Quick start

```bash
# In Slack (once deployed):
@quill write me a blog about testing OAuth 2.0 in Postman
@quill copy-edit this
@quill stage this to WordPress
@quill when could this go live?
```

Quill responds with the full markdown draft, a Confluence link, a WordPress preview link, and the next open publish slots — in that order, across the conversation. A human editor then schedules/publishes in WP admin.

---

## What Quill does

| Workflow | Trigger phrases | What happens |
|---|---|---|
| **Write blog** | "write me a blog about X", "quick draft on X" | Coverage check → optional research → write_draft → Confluence save → full markdown + Confluence link |
| **Copy-edit** | "copy-edit this", "polish this draft" | copyedit_draft → save edited version to Confluence → quality score + changes + edited markdown |
| **Stage to WordPress** | "stage this to WP", "push to WordPress" | Frontmatter-driven WP draft (auto-resolves tags, sets Yoast SEO meta, updates if title already exists). Always status=draft. |
| **When could this go live?** | "when can it go live?", "show me open slots" | Informational — surfaces next Tue/Thu open slots per editorial rules. Quill CANNOT schedule; a human editor schedules in WP admin. |
| **Blog ideas** | "what should I write about?", "blog ideas about MCP" | Parallel web_search → scored ideas grouped by urgency tier → saved as Confluence page |
| **Read Confluence page** | Paste a Confluence URL | read_confluence → route to copy-edit / write / brainstorm / stage based on what you ask |

Plus utilities: `list_wp_schedule` (editorial calendar views) and `wp_publish_stats` (counts by date range).

---

## Tool catalog

11 tools. Three make dedicated Claude calls with their own system prompts; the rest are pure API wrappers. **All WordPress interaction is read-or-stage-only** — no tool can schedule or publish posts.

| Tool | LLM | Purpose |
|---|---|---|
| `web_search` | ❌ | Tavily web search |
| `check_blog_coverage` | ❌ | Search blog.postman.com to avoid duplicating content |
| `write_draft` | ✅ | Generate 1200–1600 word blog draft with SEO frontmatter |
| `copyedit_draft` | ✅ | Polish + Postman style guide + structured JSON output |
| `blog_ideas` | ✅ | Score 8–12 ideas across 5 criteria from research input |
| `save_to_confluence` | ❌ | Create a new Confluence page from markdown |
| `read_confluence` | ❌ | Read a Confluence page back as markdown |
| `stage_to_wordpress` | ❌ | Create or update a WordPress draft (always status=draft) |
| `find_next_wp_slot` | ❌ | Informational — returns next open Tue/Thu publish slots for a human to act on |
| `list_wp_schedule` | ❌ | Editorial calendar view (upcoming / monthly / summary) |
| `wp_publish_stats` | ❌ | Date-range publish counts with monthly breakdown |

---

## Architecture

**Hybrid Mastra + dedicated Claude calls per tool.**

- Top-level Mastra agent (`agent/index.ts`) handles routing, conversation memory, and Slack streaming via `MastraAdapter` + `serve()` from `@astropods/adapter-core`.
- Tools that need their own cognition (`write_draft`, `copyedit_draft`, `blog_ideas`) make dedicated `@anthropic-ai/sdk` calls via `agent/lib/anthropic.ts` with their full SKILL-derived system prompts — preserving prompt isolation between drafting, editing, and idea-scoring cognition.
- A `UserContextAdapter` wrapper captures the Slack user ID into `AsyncLocalStorage` per request, so per-user Confluence credentials can resolve correctly.
- Pure API wrappers for WordPress REST, Confluence REST, Tavily, and the in-process scheduling logic (`lib/scheduling.ts` — US holidays + Tue/Thu rules, no API calls).

```
Slack → Astropods messaging sidecar → UserContextAdapter → MastraAdapter
        → Quill agent (top-level Claude routing)
            ├── pure API tools (WP, Confluence, Tavily)
            └── per-tool Claude calls (write_draft, copyedit_draft, blog_ideas)
                  ↳ @anthropic-ai/sdk with tool-specific system prompts
```

State is intentionally minimal in v1 — Mastra's in-memory store carries the active conversation; nothing persists across container restarts.

---

## Configuration

Astropods injects `ANTHROPIC_API_KEY` automatically via `models.anthropic.provider: anthropic` in `astropods.yml`. The other secrets you set explicitly:

| Env var | Required? | Purpose |
|---|---|---|
| `TAVILY_API_KEY` | ✅ | Web search for research + blog ideas |
| `WP_USERNAME` | ✅ | blog.postman.com WordPress login |
| `WP_APP_PASSWORD` | ✅ | WP Application Password (NOT your login password — generate at `blog.postman.com/wp-admin/profile.php` → Application Passwords) |
| `CONFLUENCE_API_TOKEN` | ✅ | Default Confluence token (used when no per-user credentials match) |
| `CONFLUENCE_BASE_URL` | optional | Defaults to `https://postman.atlassian.net/wiki` (set in `lib/confluence.ts`) |
| `CONFLUENCE_EMAIL` | optional | Default email for the default token (set in `lib/confluence.ts`) |
| `CONFLUENCE_SPACE_KEY` | optional | Default space for new pages (set in `lib/confluence.ts`) |
| `CONFLUENCE_PARENT_PAGE_ID` | optional | Optional parent page to nest drafts under |

### Per-user Confluence credentials (so pages are owned by the actual requester)

Pages created via the default token are all owned by one Atlassian user. To attribute pages to whoever is talking to Quill in Slack, register per-user credentials:

```bash
# For each team member (Slack member ID looks like U07A1B2C3):
ast secrets create CONFLUENCE_EMAIL_U07A1B2C3     # = alice@postman.com
ast secrets create CONFLUENCE_TOKEN_U07A1B2C3     # = her API token
```

Quill detects the Slack user per message and uses the matching credentials. If a user has no entry, it falls back to the default token + email — Quill still works for them, but the page is owned by the default identity.

---

## Local development

```bash
cd Quill/
ast project configure        # set the 4 required env vars
ast project start --background
# → playground at http://localhost:3100
```

Dev mode has `bun --watch` enabled, so most code edits hot-reload. New npm dependencies or `astropods.yml` changes require `ast project start --rebuild`.

```bash
ast project logs              # tail container output (timing logs from each tool)
ast project stop              # tear down
```

---

## Deployment

```bash
# 1. Push the blueprint image
ast push

# 2. Create secrets in the account vault (once)
ast secrets create TAVILY_API_KEY
ast secrets create WP_USERNAME
ast secrets create WP_APP_PASSWORD
ast secrets create CONFLUENCE_API_TOKEN
# (plus per-user CONFLUENCE_EMAIL_/TOKEN_ entries as needed)

# 3. Deploy
ast deploy @postman/quill \
  --var TAVILY_API_KEY=@ \
  --var WP_USERNAME=@ \
  --var WP_APP_PASSWORD=@ \
  --var CONFLUENCE_API_TOKEN=@ \
  --adapter web \
  --adapter slack \
  --name "Quill" \
  --wait

# 4. Connect Slack (one-time, Astro dashboard)
#    Open deployed agent → Integrations → Slack → connect workspace
```

Subsequent deploys: `ast push && ast deploy @postman/quill --var … (same flags)`.

---

## Repo layout

```
Quill/
├── astropods.yml              # blueprint spec
├── Dockerfile                 # bun runtime
├── package.json
├── tsconfig.json
├── PLAN.md                    # build history / decisions
└── agent/
    ├── index.ts               # Mastra agent + UserContextAdapter + serve()
    ├── instructions.ts        # top-level system prompt (the orchestrator)
    ├── prompts/               # blog-write, copyedit, blog-ideas system prompts
    ├── tools/                 # 12 tool definitions
    └── lib/
        ├── anthropic.ts       # @anthropic-ai/sdk wrapper for tool-internal calls
        ├── confluence.ts      # Confluence REST + per-user identity lookup
        ├── markdown.ts        # frontmatter parser + marked wrapper
        ├── scheduling.ts      # pure scheduling logic (Tue/Thu, US holidays)
        ├── user-context.ts    # AsyncLocalStorage for per-user identity
        └── wordpress.ts       # WP REST client
```

---

## Editorial scheduling rules

Encoded in `agent/lib/scheduling.ts` (pure functions, no API):

- **Time:** 8:00 AM PT (year-round Pacific time; Confluence/WP handle DST)
- **Days:** Tue/Thu first (2-week window) → Wed/Mon fallback → never Fri/Sat/Sun
- **Holidays:** US public holidays skipped — fixed (Jan 1, Jun 19, Jul 4, Nov 11, Dec 25) + floating (MLK, Presidents', Memorial, Labor, Columbus, Thanksgiving)
- **Conflicts:** One post per day; rescheduling the same post to its own slot doesn't count as a conflict
- **Embargo:** Optional per-post `embargo` date — Quill refuses slots before it

---

## Limitations / roadmap

- **No persistent state across container restarts.** Mastra memory is `:memory:` SQLite. Blog ideas don't dedupe across runs; conversation history resets if the container is rebuilt. Adding `knowledge: { cache: { provider: redis } }` lifts this.
- **Per-user Confluence requires admin onboarding.** Adding a teammate today requires running 2 `ast secrets create` commands plus a redeploy. A self-serve registration flow needs a persistent user-mapping store.
- **`scan_prod_updates` not built yet** — pulling the Postman product-updates Slack channel into a blog-ready brief is on the roadmap. Will require re-adding `SLACK_BOT_TOKEN` to `astropods.yml`.
- **Slack adapter is platform-managed** — the agent never sees a Slack bot token. The `SLACK_BOT_TOKEN` env var only comes back if `scan_prod_updates` is added (it needs its own token for `conversations.history`).
