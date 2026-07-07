---
name: Quill
description: Slack-first blog pipeline agent for Postman DevRel. Drop a topic and Quill researches, drafts, copy-edits, saves to Confluence, files a Jira ticket for a header image, and stages to WordPress as a draft — a human editor schedules and publishes.
tags: [blog, content, devrel, writing, wordpress, confluence, jira, publishing, slack]
authors: [pmmistry]
---

# Quill 🪶

> *From idea to live post, without leaving Slack.*

Quill is the Postman DevRel content-pipeline agent for [blog.postman.com](https://blog.postman.com), accessible from Slack on Astropods. One conversation replaces four tools: research → draft → copy-edit → save to Confluence → open a Jira header-image ticket → stage to WordPress as a draft. Quill never publishes — a human editor schedules and publishes from WP admin. Quill also reads existing Confluence pages, so you can drop a page link and ask for a copy-edit, a header-image ticket, or a fresh post built from it.

---

## What Quill does

| Trigger | Workflow |
|---|---|
| "write me a blog about X" | Coverage check → research → write → save to Confluence → return markdown + Confluence link |
| "copy-edit this" | Style-guide + SEO pass → save edited version → return quality score, changes, and flagged risky rewrites |
| "create a header ticket for this draft: `<confluence URL>`" | Read Confluence page → file Jira ticket in MKTG (`Header image request for blog: <title>`) with a link back to the draft |
| "stage this to WordPress" | Frontmatter-driven WP draft — auto-tags, Yoast SEO, upserts if the title already exists. Always `status=draft` |
| "when could this go live?" | Informational — surfaces the next open Tue/Thu 8am-PT slots. Cannot schedule |
| "what should I write about?" | Parallel web search → 8–12 scored ideas by urgency tier → saved to Confluence |
| Paste a Confluence URL | Routes to copy-edit / write / brainstorm / header-ticket based on what you ask |

---

## Tool catalog

12 tools. Three make dedicated Claude calls with their own system prompts; the rest are pure API wrappers. **All WordPress interaction is stage-only.**

| Tool | LLM | Purpose |
|---|---|---|
| `web_search` | ❌ | Tavily web search |
| `check_blog_coverage` | ❌ | Search blog.postman.com to avoid duplicates |
| `write_draft` | ✅ | 1200–1600 word draft with SEO frontmatter (Postman voice, banned-word enforcement) |
| `copyedit_draft` | ✅ | Style-guide + SEO polish. Returns auto-applied `changes` + flagged risky rewrites (`flags`) |
| `blog_ideas` | ✅ | Score 8–12 ideas across 5 weighted criteria |
| `save_to_confluence` | ❌ | Create a Confluence page from markdown |
| `read_confluence` | ❌ | Read a Confluence page back as markdown |
| `create_header_request` | ❌ | File a Jira ticket in MKTG with a link to the Confluence draft |
| `stage_to_wordpress` | ❌ | Create/update a WordPress draft (always `status=draft`) |
| `find_next_wp_slot` | ❌ | Informational — next open Tue/Thu publish slots |
| `list_wp_schedule` | ❌ | Editorial calendar views |
| `wp_publish_stats` | ❌ | Publish counts by date range |

---

## Architecture

**Hybrid Mastra + per-tool Claude calls.** Top-level Mastra agent (`agent/index.ts`) routes conversation and streams to Slack via `MastraAdapter` + `serve()` from `@astropods/adapter-core`. Tools needing their own cognition (`write_draft`, `copyedit_draft`, `blog_ideas`) make direct `@anthropic-ai/sdk` calls with dedicated system prompts — keeping drafting, editing, and idea-scoring prompts isolated. The rest are pure API wrappers around WordPress, Confluence, Jira, Tavily, and in-process scheduling logic.

```
Slack → Astropods messaging sidecar → MastraAdapter
        → Quill agent (top-level Claude routing)
            ├── pure API tools (WP, Confluence, Jira, Tavily)
            └── per-tool Claude calls (write_draft, copyedit_draft, blog_ideas)
```

State is intentionally minimal — Mastra's in-memory store carries the active conversation only.

---

## Configuration

`ANTHROPIC_API_KEY` is auto-injected by Astropods. Set the rest via `ast project configure`:

| Env var | Required | Purpose |
|---|---|---|
| `TAVILY_API_KEY` | ✅ | Web search |
| `WP_USERNAME` / `WP_APP_PASSWORD` | ✅ | blog.postman.com WordPress login (Application Password, not your login) |
| `CONFLUENCE_EMAIL` / `CONFLUENCE_API_TOKEN` | ✅ | Atlassian service account (also authorizes Jira — one token, both products) |
| `CONFLUENCE_SPACE_KEY` | ✅ | Destination space (e.g. `Quill`) |
| `CONFLUENCE_BASE_URL` | optional | Defaults to `https://postmanlabs.atlassian.net/wiki` |
| `CONFLUENCE_PARENT_PAGE_ID` | optional | Nest drafts under a specific parent page |
| `JIRA_PROJECT_KEY` | optional | Defaults to `MKTG` |
| `JIRA_HEADER_ISSUE_TYPE` | optional | Defaults to `Task` |
| `JIRA_MARKETING_TEAM` | optional | Required MKTG field. Defaults to `Creative` |
| `JIRA_BASE_URL` | optional | Derived from `CONFLUENCE_BASE_URL` — override only if your Jira lives elsewhere |

### Service-account pattern

Quill uses **one shared Atlassian identity** for both Confluence and Jira — a dedicated service-account user (e.g. `service.quill@postman.com`) with an API token that has (a) write access to the shared Confluence drafts space and (b) issue-create permission on the Jira `MKTG` project. Deploy once, one auth for the whole team, every draft and ticket owned by the bot.

One-time admin setup:
1. Create the service-account user in Atlassian.
2. Create the shared Confluence drafts space, grant "Add pages".
3. Grant Jira `MKTG` "Create issue" permission.
4. Generate an API token while signed in as the service account.

---

## Local dev & deployment

```bash
ast project configure                       # set required env vars
ast project start --background              # playground at http://localhost:3100
ast project logs                            # tail container output
```

`bun --watch` hot-reloads code edits. `astropods.yml` or dependency changes need `ast project start --rebuild`.

Deploy:

```bash
ast push
ast secrets create TAVILY_API_KEY WP_USERNAME WP_APP_PASSWORD CONFLUENCE_API_TOKEN

ast deploy @postman/quill \
  --var TAVILY_API_KEY=@ --var WP_USERNAME=@ --var WP_APP_PASSWORD=@ \
  --var CONFLUENCE_API_TOKEN=@ \
  --var CONFLUENCE_EMAIL=service.quill@postman.com \
  --var CONFLUENCE_SPACE_KEY=Quill \
  --adapter web --adapter slack --name "Quill" --wait
```

Then connect Slack in the Astro dashboard: deployed agent → Integrations → Slack → connect workspace.

---

## Repo layout

```
Quill/
├── astropods.yml              # blueprint spec
├── Dockerfile                 # bun runtime
├── PLAN.md                    # build history / decisions
└── agent/
    ├── index.ts               # Mastra agent + serve()
    ├── instructions.ts        # top-level routing system prompt
    ├── prompts/               # write, copyedit, ideas, shared style-guide
    ├── tools/                 # 12 tool definitions
    └── lib/
        ├── anthropic.ts       # @anthropic-ai/sdk wrapper
        ├── confluence.ts      # Confluence REST client
        ├── jira.ts            # Jira REST v3 client (ADF)
        ├── wordpress.ts       # WP REST client
        ├── markdown.ts        # frontmatter + marked wrapper
        └── scheduling.ts      # Tue/Thu + US holiday logic
```

---

## Editorial scheduling rules

Pure functions in `agent/lib/scheduling.ts` — no API calls:

- **Time:** 8:00 AM PT year-round.
- **Days:** Tue/Thu first (2-week window) → Wed/Mon fallback → never Fri/Sat/Sun.
- **Holidays:** US public holidays skipped (fixed + floating).
- **Conflicts:** One post per day.
- **Embargo:** Per-post `embargo` date honored.

---

## Limitations / roadmap

- **No persistent state.** Conversation memory resets on container rebuild; blog ideas don't dedupe across runs. Adding a persistent knowledge store lifts this.
- **`scan_prod_updates` not built yet** — pulling Postman #product-updates into a blog-ready brief is on the roadmap and will need a Slack bot token.
- **Slack adapter is platform-managed** — the agent never sees a Slack bot token unless `scan_prod_updates` adds one.
