# Quill 🪶

> *From idea to live post, without leaving Slack.*

Quill is a Slack-first blog pipeline agent for Postman's DevRel team. Drop a topic in Slack and Quill researches it, drafts in Postman's developer-advocate voice, copy-edits for grammar / SEO / brand voice, saves every version to Confluence, files a Jira ticket for a matching header image, and stages the post to [blog.postman.com](https://blog.postman.com) as a WordPress draft — all in one conversation. **Scheduling and publishing stay with a human editor** in the WP admin panel. Quill can surface the next open Tue/Thu 8am PT publish slots as guidance but never acts on them.

Built on [Mastra](https://mastra.ai) and deployed to the [Astropods](https://astropods.com) platform.

---

## What it looks like

```
You    @quill write me a blog about testing OAuth 2.0 in Postman

Quill  🔎 Checking if we've covered this already...
       ✅ No existing coverage on "testing OAuth 2.0 in Postman".
       ✍️ Writing your draft — about 30 seconds...
       📁 Saving to Confluence...
       🎨 Creating a header image request in Jira...

       🪶 Your draft is ready — a hands-on guide to testing OAuth 2.0
       authorization-code flow in Postman.

       📄 Confluence: https://postmanlabs.atlassian.net/wiki/.../
       🎫 Jira header ticket: MKTG-10528

       ```markdown
       ---
       suggested_title: "Testing OAuth 2.0 flows in Postman"
       meta_description: "Test OAuth 2.0 authorization code flow in Postman
       with environment variables and test scripts."
       primary_keyword: "OAuth 2.0 testing Postman"
       seo_score: 87
       ---
       # Testing OAuth 2.0 flows in Postman
       ...
       ```

       Want me to copy-edit it? Just say "copy-edit this".

You    copy-edit this and stage it to WordPress

Quill  ✂️ Copy-editing — about 30 seconds...
       📁 Saving edited version to Confluence...
       📤 Staging to WordPress...

       ✂️ Copy-edit done · Quality score: 9/10
       ⚠️  2 flagged rewrites for your review (voice imbalance in §2,
          weak title "Ultimate Guide" pattern)
       📤 Staged as draft #12345 on blog.postman.com

       Quill is staging-only — a human editor schedules in the WP admin
       panel. Say "when could this go live?" for open slots.
```

---

## ✨ Features

- 🔎 **Coverage check before drafting** — searches blog.postman.com first to avoid duplicates
- ✍️ **Postman-voice drafting** — 1200–1600 word technical drafts with SEO frontmatter, banned-word enforcement, and hybrid I/you/we voice
- ✂️ **Copy-editing with flags** — auto-applies mechanical fixes (typos, banned words, code fences, capitalization); flags risky rewrites (sentence length, voice imbalance, weak titles) for human review
- 📁 **Confluence sync** — every draft + every edit gets a Confluence page in the shared "Quill Drafts" space, owned by a bot service account
- 🎨 **Automatic header-image tickets** — files a Jira ticket in `MKTG` with a link back to the Confluence draft so the design team can start work in parallel
- 📤 **WordPress staging** — frontmatter-driven WP draft create-or-update, auto-tags, Yoast SEO. **Always `status=draft` — Quill never publishes.**
- 📅 **Editorial slot suggestions** — next open Tue/Thu 8am PT slots per the editorial rules (no Fri/Sat/Sun, no US holidays, no same-day conflicts). Informational only.
- 📊 **Blog ideas** — parallel research + 0–100 scored ideas across 5 weighted criteria
- 📈 **Publishing stats** — post counts across any date range with monthly breakdown
- 🔄 **Read existing Confluence pages** — paste a URL and Quill imports it as markdown to copy-edit, rewrite as a blog, or file a header-image ticket for it

---

## Quick start (Slack)

```
@quill what should I write about MCP servers?
@quill write me a blog about API rate limiting strategies
@quill copy-edit this
@quill stage this to WordPress
@quill create a header ticket for this draft: <confluence URL>
@quill when could this go live?
@quill how many posts did we publish in Q1 2026?
```

---

## Workflows

| # | Trigger | What Quill does |
|---|---|---|
| 1 | "write me a blog about X" | Coverage check → optional research → draft → Confluence save → Jira header ticket → reply with markdown + links |
| 2 | "copy-edit this" | Copyedit → save edited version to Confluence → quality report + auto-applied changes + flagged suggestions |
| 3 | "stage this to WordPress" | Parse frontmatter → resolve tags → create or update WP draft (always `status=draft`) |
| 4 | "create a header ticket for this draft: `<confluence URL>`" | Read Confluence page → file Jira ticket in `MKTG` with a link back to the draft |
| 5 | "when could this go live?" | Show next Tue/Thu open publish slots (informational — human schedules in WP admin) |
| 6 | "what should I write about?" | Parallel web searches → 8–12 scored ideas by urgency tier → Confluence save |
| 7 | Paste a Confluence URL | Read page as markdown → route to copyedit / write / blog_ideas / stage / header-ticket |

Plus quick lookups: `list_wp_schedule` (editorial calendar) and `wp_publish_stats` (date-range counts).

---

## Tool catalog

12 tools — three make dedicated Claude calls with their own system prompts; the rest are pure API wrappers. **All WordPress interaction is stage-only.**

| Tool | Calls Claude? | Purpose |
|---|:---:|---|
| `web_search` | — | Tavily web search |
| `check_blog_coverage` | — | Search blog.postman.com to avoid duplicating content |
| `write_draft` | ✅ | 1200–1600 word draft with SEO frontmatter and Postman-voice rules |
| `copyedit_draft` | ✅ | Style-guide + SEO polish. Returns auto-applied `changes` + risky-rewrite `flags` |
| `blog_ideas` | ✅ | Score 8–12 ideas across 5 weighted criteria |
| `save_to_confluence` | — | Create a Confluence page from markdown |
| `read_confluence` | — | Read a Confluence page back as markdown |
| `create_header_request` | — | File a Jira ticket in `MKTG` linking back to the Confluence draft |
| `stage_to_wordpress` | — | Create/update a WordPress draft (always `status=draft`) |
| `find_next_wp_slot` | — | Informational — next open Tue/Thu publish slots |
| `list_wp_schedule` | — | Editorial calendar view |
| `wp_publish_stats` | — | Date-range publish counts with monthly breakdown |

---

## Architecture

**Hybrid Mastra + per-tool Claude calls.**

```
Slack ──► Astropods messaging sidecar ──► MastraAdapter
                                              │
                                              ▼
                                          Quill Mastra agent
                                              │
                              ┌───────────────┼─────────────────────────┐
                              │               │                         │
                       pure API tools    LLM-backed tools     Mastra conversation memory
                       (WP, Confluence,  (write_draft,        (in-memory SQLite, per-thread)
                        Jira, Tavily,    copyedit_draft,
                        scheduling)      blog_ideas)
                                              │
                                              ▼
                                         @anthropic-ai/sdk
                                         with tool-specific
                                         system prompts
```

- **Top-level Mastra agent** handles routing, conversation memory, and Slack streaming.
- **Tools that need cognition** (`write_draft`, `copyedit_draft`, `blog_ideas`) make their own Anthropic SDK calls with dedicated system prompts. This preserves prompt isolation between drafting, editing, and scoring. The writer and copy-editor share a `prompts/style-guide.ts` file so voice/code/banned-word rules never drift.
- **Pure API tools** wrap WordPress REST, Confluence REST, Jira REST v3 (ADF), Tavily, and an in-process scheduling library (`lib/scheduling.ts`).

State is intentionally minimal — Mastra's in-memory store carries the active conversation; nothing persists across container restarts.

---

## Service-account pattern

Quill uses **one shared Atlassian identity** for both Confluence and Jira — a dedicated service-account user (e.g. `service.quill@postman.com`, NOT a personal email) with an API token that has (a) write access to the shared "Quill Drafts" Confluence space and (b) issue-create permission on the Jira `MKTG` project. Every draft and every ticket is owned by the bot. Deploy once, one auth for the whole team.

One-time admin setup:
1. Create the service-account user in Atlassian.
2. Create the shared "Quill Drafts" Confluence space; grant "Add pages".
3. Grant Jira `MKTG` "Create issue" permission.
4. Generate an API token while signed in as the service account.

---

## Configuration

Astropods auto-injects `ANTHROPIC_API_KEY` because `astropods.yml` declares `models.anthropic.provider: anthropic`. Set the rest via `ast project configure`:

| Env var | Required? | Purpose |
|---|:---:|---|
| `TAVILY_API_KEY` | ✅ | Web search |
| `WP_USERNAME` | ✅ | blog.postman.com WordPress username |
| `WP_APP_PASSWORD` | ✅ | WP Application Password (not your login password) |
| `CONFLUENCE_EMAIL` | ✅ | Service-account email — also authorizes Jira |
| `CONFLUENCE_API_TOKEN` | ✅ | API token for the service account — one token, both products |
| `CONFLUENCE_SPACE_KEY` | ✅ | Destination space (e.g. `Quill`) |
| `CONFLUENCE_BASE_URL` | optional | Defaults to `https://postmanlabs.atlassian.net/wiki` |
| `CONFLUENCE_PARENT_PAGE_ID` | optional | Nest drafts under a specific parent page |

Jira header-ticket settings (`MKTG` project, `Task` issue type, `Marketing Team = Creative`, base URL derived from `CONFLUENCE_BASE_URL`, no auto-assignee) are hardcoded as defaults in [`agent/lib/jira.ts`](agent/lib/jira.ts). They are intentionally **not exposed as env vars** — change the defaults in code and redeploy if they need to move.

---

## Local development

```bash
git clone https://github.com/Postman-Devrel/Quill.git
cd Quill
ast project configure       # set required env vars
ast project start --background
```

Then open the playground at http://localhost:3100.

```bash
ast project logs            # tail container logs (per-tool timing breadcrumbs)
ast project stop            # tear down
```

`bun --watch` is set as the dev command in `astropods.yml`, so most code edits hot-reload. New npm dependencies or `astropods.yml` changes require `ast project start --rebuild`.

---

## Deployment

```bash
# 1. Push the blueprint image
ast push

# 2. Create secrets in the account vault (once per secret)
ast secrets create TAVILY_API_KEY
ast secrets create WP_USERNAME
ast secrets create WP_APP_PASSWORD
ast secrets create CONFLUENCE_API_TOKEN

# 3. Deploy — secrets via @ shorthand, non-secret vars passed literally
ast deploy @postman/quill \
  --var TAVILY_API_KEY=@ \
  --var WP_USERNAME=@ \
  --var WP_APP_PASSWORD=@ \
  --var CONFLUENCE_API_TOKEN=@ \
  --var CONFLUENCE_EMAIL=service.quill@postman.com \
  --var CONFLUENCE_SPACE_KEY=Quill \
  --adapter web \
  --adapter slack \
  --name "Quill" \
  --wait

# 4. Connect Slack (one-time)
#    Astro dashboard → deployed agent → Integrations → Slack → connect workspace
```

Subsequent deploys: `ast push && ast deploy @postman/quill …` with the same flags.

See [`AGENT.md`](AGENT.md) for the full blueprint card.

---

## Editorial scheduling rules

Encoded in [`agent/lib/scheduling.ts`](agent/lib/scheduling.ts) as pure functions (no API calls — fully testable).

- **Time:** 8:00 AM PT year-round (Confluence/WP handle DST).
- **Days:** Tue/Thu first (2-week lookahead) → Wed/Mon fallback → never Fri/Sat/Sun.
- **Holidays:** US public holidays skipped — fixed (Jan 1, Jun 19, Jul 4, Nov 11, Dec 25) + floating (MLK, Presidents', Memorial, Labor, Columbus, Thanksgiving).
- **Conflicts:** One post per day.
- **Embargo:** Optional per-post `embargo` date — Quill refuses slots before it.

When a target date is rejected, Quill suggests 3 valid alternatives starting from the requested date.

---

## Repo layout

```
Quill/
├── astropods.yml              # blueprint spec
├── Dockerfile                 # bun runtime
├── package.json
├── tsconfig.json
├── AGENT.md                   # Astropods blueprint card
├── PLAN.md                    # build history / decisions
├── README.md                  # this file
└── agent/
    ├── index.ts               # Mastra agent + serve()
    ├── instructions.ts        # top-level routing system prompt
    ├── prompts/
    │   ├── blog-write.ts      # writer system prompt
    │   ├── copyedit.ts        # copy-editor system prompt (auto-fix + flags)
    │   ├── blog-ideas.ts      # idea-scoring system prompt
    │   └── style-guide.ts     # shared voice/code/banned-word blocks
    ├── tools/                 # 12 tool definitions
    └── lib/
        ├── anthropic.ts       # @anthropic-ai/sdk wrapper
        ├── confluence.ts      # Confluence REST client (service account)
        ├── jira.ts            # Jira REST v3 client (ADF descriptions)
        ├── wordpress.ts       # WP REST client
        ├── markdown.ts        # frontmatter + marked wrapper
        └── scheduling.ts      # Tue/Thu + US holiday logic
```

---

## Roadmap

- [ ] **`scan_prod_updates` tool** — pull shipped features from the Postman #product-updates Slack channel into a blog-ready brief
- [ ] **Persistent state** — add a persistent knowledge backend so blog ideas dedupe across runs and conversation history survives container restarts
- [ ] **Slack Block Kit replies** — buttons for "copy-edit", "stage", "header ticket" instead of typed follow-ups
- [ ] **Auto-attach header image** — poll the Jira ticket, download the attached image once ready, upload as WP featured media

---

## Stack

- **Runtime:** [Bun](https://bun.sh) 1.x
- **Agent framework:** [Mastra](https://mastra.ai)
- **Platform:** [Astropods](https://astropods.com) (`@astropods/adapter-core` + `@astropods/adapter-mastra`)
- **LLM:** Anthropic Claude Sonnet (via `@anthropic-ai/sdk` — direct calls)
- **Other:** `marked` (md → HTML), `turndown` (HTML → md), `yaml` (frontmatter), `zod` (tool schemas)

---

## Contributing

Quill is built and maintained by the Postman DevRel team. Pull requests welcome from teammates; for external contributions, please open an issue first to discuss scope.
