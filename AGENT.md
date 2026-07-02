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
- Pure API wrappers for WordPress REST, Confluence REST, Tavily, and the in-process scheduling logic (`lib/scheduling.ts` — US holidays + Tue/Thu rules, no API calls).

```
Slack → Astropods messaging sidecar → MastraAdapter
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
| `CONFLUENCE_EMAIL` | ✅ | Service-account email (e.g. `quill@postman.com`) — NOT a personal address |
| `CONFLUENCE_API_TOKEN` | ✅ | API token for the service account |
| `CONFLUENCE_SPACE_KEY` | ✅ | Shared destination space key (e.g. `QUILL` or `BLOG-DRAFTS`) |
| `CONFLUENCE_BASE_URL` | optional | Defaults to `https://postmanlabs.atlassian.net/wiki` |
| `CONFLUENCE_PARENT_PAGE_ID` | optional | Nest drafts under a specific parent page in the space |

### Service-account pattern

Quill uses **one shared identity** for Confluence — a dedicated service-account user (e.g. `quill@postman.com`, NOT a personal email) with an API token that has write access to one shared "Quill Drafts" space. Every team member using Quill gets their drafts saved to the same place, owned by the bot. Deploy once, one auth for the whole company.

Setup requires (one time, by an admin):
1. Create the service-account user in Atlassian
2. Create the shared "Quill Drafts" Confluence space
3. Grant the service account "Add pages" permission on that space
4. Generate an API token while signed in AS the service account

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

# 3. Deploy — secrets referenced with `@`, non-secret vars passed literally
ast deploy @postman/quill \
  --var TAVILY_API_KEY=@ \
  --var WP_USERNAME=@ \
  --var WP_APP_PASSWORD=@ \
  --var CONFLUENCE_API_TOKEN=@ \
  --var CONFLUENCE_EMAIL=quill@postman.com \
  --var CONFLUENCE_SPACE_KEY=QUILL \
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
    ├── index.ts               # Mastra agent + serve()
    ├── instructions.ts        # top-level system prompt (the orchestrator)
    ├── prompts/               # blog-write, copyedit, blog-ideas system prompts
    ├── tools/                 # 12 tool definitions
    └── lib/
        ├── anthropic.ts       # @anthropic-ai/sdk wrapper for tool-internal calls
        ├── confluence.ts      # Confluence REST + per-user identity lookup
        ├── markdown.ts        # frontmatter parser + marked wrapper
        ├── scheduling.ts      # pure scheduling logic (Tue/Thu, US holidays)
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
