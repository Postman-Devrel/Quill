# Quill 🪶

> *From idea to live post, without leaving Slack.*

Quill is a Slack-first blog pipeline agent for Postman's DevRel team. Drop a topic in Slack and Quill researches it, drafts in Postman's developer-advocate voice, copy-edits for grammar / SEO / brand voice, saves every version to Confluence, and stages it to [blog.postman.com](https://blog.postman.com) as a WordPress draft — all in one conversation. **Scheduling and publishing stay with a human editor** in the WP admin panel; Quill can surface the next open Tue/Thu 8am PT publish slots as guidance but never acts on them.

Built on [Mastra](https://mastra.ai) and deployed to the [Astropods](https://astropods.com) platform.

---

## What it looks like

```
You    @quill write me a blog about testing OAuth 2.0 in Postman

Quill  🔎 Checking if we've covered this already...
       ✅ No existing coverage on "testing OAuth 2.0 in Postman".
       ✍️ Writing your draft — about 30 seconds...
       📁 Saving to Confluence...

       🪶 Your draft is ready — a hands-on guide to testing OAuth 2.0
       authorization-code flow in Postman with environment variables and
       test scripts.

       📄 Confluence: https://postman.atlassian.net/wiki/spaces/DEVREL/pages/...

       ```markdown
       ---
       suggested_title: "Testing OAuth 2.0 flows in Postman"
       meta_description: "Learn how to test OAuth 2.0 authorization code
       flow in Postman with environment variables and test scripts."
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
       📤 Staged as draft #12345 on blog.postman.com

       The draft is staged. A human editor needs to schedule it in the WP
       admin panel — Quill is staging-only. Want to know the next open
       publish slots? Say "when could this go live?"
```

---

## ✨ Features

- 🔎 **Coverage check before drafting** — searches blog.postman.com first to avoid duplicating content
- ✍️ **Postman-voice drafting** — 1200–1600 word technical drafts with YAML SEO frontmatter
- ✂️ **Copy-editing** — grammar, repetitive structure, Postman style guide compliance, branded-term capitalization, SEO scoring
- 📁 **Confluence sync** — every draft + every edit gets a new Confluence page in a shared "Quill Drafts" space, owned by a bot service account
- 📤 **WordPress staging** — frontmatter-driven WP draft create-or-update, auto-resolves tags, sets Yoast SEO metadata. **Always status=draft — Quill never publishes.**
- 📅 **Editorial slot suggestions** — surfaces the next open Tue/Thu 8am PT slots per the editorial rules (Fri/Sat/Sun and US holidays excluded, no same-day conflicts). Informational only — a human editor still schedules in WP admin.
- 📊 **Blog ideas** — parallel research + 0–100 scored ideas across 5 weighted criteria
- 📈 **Publishing stats** — counts published posts across any date range with monthly breakdown
- 🔄 **Read existing Confluence pages** — paste a page URL and Quill imports it as markdown to copy-edit, rewrite as a blog, or brainstorm ideas from

---

## Quick start (Slack)

Once deployed and `@quill` is in your channel:

```
@quill what should I write about MCP servers?
@quill write me a blog about API rate limiting strategies
@quill copy-edit this
@quill stage this to WordPress
@quill when could this go live?
@quill how many posts did we publish in Q1 2026?
@quill show me what's on the editorial calendar
@quill https://postman.atlassian.net/wiki/spaces/.../pages/123/My-Notes — turn this into a blog post
```

---

## Workflows

| # | Trigger | What Quill does |
|---|---|---|
| 1 | "write me a blog about X" | Coverage check → optional research → draft → Confluence save → reply with markdown + link |
| 2 | "copy-edit this" | Copyedit → save edited version to Confluence → quality report + edited markdown |
| 3 | "stage this to WordPress" | Parse frontmatter → resolve tags → create or update WP draft (always status=draft) |
| 4 | "when could this go live?" | Show next Tue/Thu open publish slots (informational — human schedules in WP admin) |
| 5 | "what should I write about?" | 8–12 parallel web searches → scored ideas grouped by urgency tier → Confluence save |
| 6 | Paste a Confluence URL | Read page as markdown → route to copyedit / write / blog_ideas / stage |

Plus quick lookups: `list_wp_schedule` (editorial calendar), `wp_publish_stats` (date-range counts).

---

## Tool catalog

11 tools — three make dedicated Claude calls with their own system prompts; the rest are pure API wrappers. **All WordPress interaction is read-or-stage-only.** No tool can schedule or publish.

| Tool | Calls Claude? | Purpose |
|---|:---:|---|
| `web_search` | — | Tavily web search |
| `check_blog_coverage` | — | Search blog.postman.com to avoid duplicating content |
| `write_draft` | ✅ | Generate a 1200–1600 word blog draft with SEO frontmatter |
| `copyedit_draft` | ✅ | Polish + Postman style guide + structured JSON output |
| `blog_ideas` | ✅ | Score 8–12 ideas across 5 weighted criteria from research input |
| `save_to_confluence` | — | Create a new Confluence page from markdown |
| `read_confluence` | — | Read a Confluence page back as markdown |
| `stage_to_wordpress` | — | Create or update a WordPress draft (always status=draft) |
| `find_next_wp_slot` | — | Informational — returns next open Tue/Thu publish slots for a human to act on |
| `list_wp_schedule` | — | Editorial calendar view (upcoming / monthly / summary) |
| `wp_publish_stats` | — | Date-range publish counts with monthly breakdown |

---

## Architecture

Quill is **a Mastra agent with a thin per-request user-context wrapper, plus dedicated Claude calls inside the tools that need their own cognition.**

```
Slack ──► Astropods messaging sidecar ──► UserContextAdapter (captures Slack userId)
                                              │
                                              ▼
                                          MastraAdapter
                                              │
                                              ▼
                                          Quill Mastra agent
                                              │
                              ┌───────────────┼────────────────────────────┐
                              │               │                            │
                       pure API tools    LLM-backed tools         Mastra conversation memory
                       (WP, Confluence,  (write_draft,            (in-process SQLite, per-thread)
                        Tavily,          copyedit_draft,
                        scheduling)      blog_ideas)
                                              │
                                              ▼
                                         @anthropic-ai/sdk
                                         with tool-specific
                                         system prompts
```

- **Top-level Mastra agent** handles routing, conversation memory, Slack streaming.
- **Tools that need cognition** (`write_draft`, `copyedit_draft`, `blog_ideas`) make their own Anthropic SDK calls with full SKILL-derived system prompts. This preserves prompt isolation between drafting / editing / scoring.
- **Pure API tools** wrap WordPress REST, Confluence REST, Tavily, and an in-process scheduling library (US holidays + Tue/Thu rules in `lib/scheduling.ts`).

State is intentionally minimal in v1 — Mastra's in-memory store carries the active conversation; nothing persists across container restarts. Adding the Astropods Redis knowledge backend will lift this.

---

## Service-account pattern

Quill uses **one shared Confluence identity** — a dedicated service-account user (e.g. `quill@postman.com`, NOT a personal email) with an API token that has write access to one shared "Quill Drafts" space. Every team member using Quill gets their drafts saved to the same place, owned by the bot. Deploy once, one auth for the whole company.

Setup requires (one time, by an admin):
1. Create the service-account user in Atlassian
2. Create the shared "Quill Drafts" Confluence space
3. Grant the service account "Add pages" permission on that space
4. Generate an API token while signed in AS the service account

---

## Configuration

Astropods auto-injects `ANTHROPIC_API_KEY` because `astropods.yml` declares `models.anthropic.provider: anthropic`. You set the rest:

| Env var | Required? | Purpose |
|---|:---:|---|
| `TAVILY_API_KEY` | ✅ | Web search for research + blog ideas |
| `WP_USERNAME` | ✅ | blog.postman.com WordPress username |
| `WP_APP_PASSWORD` | ✅ | WP Application Password (not your login password) |
| `CONFLUENCE_EMAIL` | ✅ | Service-account email (e.g. `quill@postman.com`) — NOT a personal address |
| `CONFLUENCE_API_TOKEN` | ✅ | API token for the service account |
| `CONFLUENCE_SPACE_KEY` | ✅ | Shared destination space key (e.g. `QUILL` or `BLOG-DRAFTS`) |
| `CONFLUENCE_BASE_URL` | optional | Defaults to `https://postmanlabs.atlassian.net/wiki` |
| `CONFLUENCE_PARENT_PAGE_ID` | optional | Nest drafts under a specific parent page |

Defaults for base URL, email, space key, and parent page live in [`agent/lib/confluence.ts`](agent/lib/confluence.ts) — edit them once for your org instead of setting env vars.

---

## Local development

```bash
git clone https://github.com/Postman-Devrel/Quill.git
cd Quill
ast project configure       # set the 4 required env vars
ast project start --background
```

Then open the playground at http://localhost:3100.

```bash
ast project logs            # tail live container logs (timing breadcrumbs from each tool)
ast project stop            # tear down
```

`dev.command: bun --watch run agent/index.ts` is set in `astropods.yml`, so most code edits hot-reload. New npm dependencies or `astropods.yml` changes require `ast project start --rebuild`.

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
  --var CONFLUENCE_EMAIL=quill@postman.com \
  --var CONFLUENCE_SPACE_KEY=QUILL \
  --adapter web \
  --adapter slack \
  --name "Quill" \
  --wait

# 4. Connect Slack (one-time)
#    Astro dashboard → deployed agent → Integrations → Slack → connect workspace
```

Subsequent deploys: `ast push && ast deploy @postman/quill --var … (same flags)`.

See [`AGENT.md`](AGENT.md) for the full blueprint card.

---

## Editorial scheduling rules

Encoded in [`agent/lib/scheduling.ts`](agent/lib/scheduling.ts) as pure functions (no API calls — fully testable).

- **Time:** 8:00 AM PT, year-round (Confluence/WP handle DST conversion)
- **Days:**
  1. Tue / Thu first, within a 2-week lookahead window
  2. Wed / Mon as fallback (only if all Tue/Thu in the window are booked)
  3. Never Fri / Sat / Sun
- **Holidays:** US public holidays skipped — fixed (Jan 1, Jun 19, Jul 4, Nov 11, Dec 25) + floating (MLK Day, Presidents' Day, Memorial Day, Labor Day, Columbus Day, Thanksgiving)
- **Conflicts:** One post per day. Rescheduling a post to its own slot doesn't count as a conflict.
- **Embargo:** Optional per-post `embargo` date — Quill refuses any slot before it.

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
    ├── index.ts               # Mastra agent + UserContextAdapter + serve()
    ├── instructions.ts        # top-level system prompt (the orchestrator)
    ├── prompts/               # blog-write, copyedit, blog-ideas system prompts
    ├── tools/                 # 12 tool definitions
    └── lib/
        ├── anthropic.ts       # @anthropic-ai/sdk wrapper for tool-internal calls
        ├── confluence.ts      # Confluence REST client (service-account identity)
        ├── markdown.ts        # frontmatter parser + marked wrapper
        ├── scheduling.ts      # pure scheduling logic (Tue/Thu, US holidays)
        └── wordpress.ts       # WP REST client
```

---

## Roadmap

- [ ] **`scan_prod_updates` tool** — pull recent shipped features from the Postman #product-updates Slack channel and produce a blog-ready brief
- [ ] **Persistent state** — add the Astropods Redis knowledge backend so blog ideas dedupe across runs and conversation history survives container restarts
- [ ] **Self-serve user registration** — DM Quill `@quill register me my-email@postman.com <token>` instead of needing an admin to add new team members via `ast secrets create`
- [ ] **Slack Block Kit replies** — richer Slack UI (buttons for "copy-edit", "stage", "schedule" instead of typed follow-ups)
- [ ] **Featured image generation** — re-add header-image support via Gemini / nano-banana, upload as WP media

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
