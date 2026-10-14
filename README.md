# Quill 🪶

> *From idea to live post, without leaving Slack.*

Quill is a Slack-first blog pipeline agent for Postman's DevRel team. Drop a topic in Slack and Quill researches it, drafts in Postman's developer-advocate voice, copy-edits for grammar / SEO / brand voice, saves every version to Confluence or a Google Doc (your choice), files a Jira ticket for a matching header image, and stages the post to [blog.postman.com](https://blog.postman.com) as a WordPress draft — all in one conversation. You can also hand Quill a Google Doc or Confluence link directly and it'll copy-edit, rewrite, or stage straight from it. **Scheduling and publishing stay with a human editor** in the WP admin panel. Quill can surface the next open Tue/Thu 8am PT publish slots as guidance but never acts on them.

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
- 📁 **Confluence or Google Docs sync** — every draft + every edit is saved to the shared "Quill Drafts" Confluence space OR a Google Doc, whichever the user picks (asked once per conversation)
- 🎨 **Automatic header-image tickets** — files a Jira ticket in `MKTG` with a link back to the draft so the design team can start work in parallel
- 📤 **WordPress staging** — frontmatter-driven WP draft create-or-update, auto-tags, Yoast SEO. **Always `status=draft` — Quill never publishes.** Can stage straight from a Google Doc or Confluence link.
- 📅 **Editorial slot suggestions** — next open Tue/Thu 8am PT slots per the editorial rules (no Fri/Sat/Sun, no US holidays, no same-day conflicts). Informational only.
- 📊 **Blog ideas** — parallel research + 0–100 scored ideas across 5 weighted criteria
- 📈 **Publishing stats** — post counts across any date range with monthly breakdown
- 🔄 **Read existing Confluence pages or Google Docs** — paste a URL and Quill imports it as markdown to copy-edit, rewrite as a blog, stage to WordPress, or file a header-image ticket for it

---

## Quick start (Slack)

```
@quill what should I write about MCP servers?
@quill write me a blog about API rate limiting strategies
@quill copy-edit this
@quill copy-edit this: <google doc URL>
@quill stage this to WordPress
@quill stage this to WordPress: <google doc URL>
@quill create a header ticket for this draft: <confluence URL>
@quill when could this go live?
@quill how many posts did we publish in Q1 2026?
```

---

## Workflows

| # | Trigger | What Quill does |
|---|---|---|
| 1 | "write me a blog about X" | Coverage check → optional research → draft → save draft (ask Google Doc/Confluence once) → Jira header ticket → reply with markdown + links |
| 2 | "copy-edit this" | Copyedit → save edited version → quality report + auto-applied changes + flagged suggestions |
| 3 | "stage this to WordPress" | Parse frontmatter → resolve tags → create or update WP draft (always `status=draft`) |
| 4 | "create a header ticket for this draft: `<URL>`" | File Jira ticket in `MKTG` with a link back to the draft (Confluence or Google Doc) |
| 5 | "when could this go live?" | Show next Tue/Thu open publish slots (informational — human schedules in WP admin) |
| 6 | "what should I write about?" | Parallel web searches → 8–12 scored ideas by urgency tier → save draft |
| 7 | Paste a Confluence URL | Read page as markdown → route to copyedit / write / blog_ideas / stage / header-ticket |
| 8 | Paste a Google Doc URL | Read doc as markdown → route to copyedit / write / blog_ideas / stage / header-ticket |

Plus quick lookups: `list_wp_schedule` (editorial calendar) and `wp_publish_stats` (date-range counts).

---

## Tool catalog

Most tools are pure API wrappers; `write_draft`, `copyedit_draft`, and `blog_ideas` make dedicated
Claude calls with their own system prompts. **All WordPress interaction is stage-only.**

| Tool | Calls Claude? | Purpose |
|---|:---:|---|
| `web_search` | — | Tavily web search |
| `check_blog_coverage` | — | Search blog.postman.com to avoid duplicating content |
| `write_draft` | ✅ | 1200–1600 word draft with SEO frontmatter and Postman-voice rules |
| `copyedit_draft` | ✅ | Style-guide + SEO polish. Returns auto-applied `changes` + risky-rewrite `flags` |
| `blog_ideas` | ✅ | Score 8–12 ideas across 5 weighted criteria |
| `save_to_confluence` | — | Create a Confluence page from markdown |
| `read_confluence` | — | Read a Confluence page back as markdown |
| `save_to_google_doc` | — | Create a Google Doc from markdown (Drive API, service account) |
| `read_google_doc` | — | Read an accessible Google Doc as markdown using the service account |
| `create_header_request` | — | File a Jira ticket in `MKTG` linking back to the draft (Confluence or Google Doc) |
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
                        Google Drive,    copyedit_draft,
                        Jira, Tavily,    blog_ideas)
                        scheduling)
                                              │
                                              ▼
                                         @anthropic-ai/sdk
                                         with tool-specific
                                         system prompts
```

- **Top-level Mastra agent** handles routing, conversation memory, and Slack streaming.
- **Tools that need cognition** (`write_draft`, `copyedit_draft`, `blog_ideas`) make their own Anthropic SDK calls with dedicated system prompts. This preserves prompt isolation between drafting, editing, and scoring. The writer and copy-editor share a `prompts/style-guide.ts` file so voice/code/banned-word rules never drift.
- **Pure API tools** wrap WordPress REST, Confluence REST, Google Drive REST (`lib/google-drive.ts`), Jira REST v3 (ADF), Tavily, and an in-process scheduling library (`lib/scheduling.ts`).

State is intentionally minimal — Mastra's in-memory store carries the active conversation; nothing persists across container restarts.

---

## Service-account pattern

Quill uses **one shared Atlassian identity** for both Confluence and Jira — a dedicated service-account user (e.g. `service.quill@postman.com`, NOT a personal email) with an API token that has (a) write access to the shared "Quill Drafts" Confluence space and (b) issue-create permission on the Jira `MKTG` project. Every draft and every ticket is owned by the bot. Deploy once, one auth for the whole team.

One-time admin setup:
1. Create the service-account user in Atlassian.
2. Create the shared "Quill Drafts" Confluence space; grant "Add pages".
3. Grant Jira `MKTG` "Create issue" permission.
4. Generate an API token while signed in as the service account.

The same pattern extends to Google: **one shared Google Cloud service account** creates every
Google Doc draft. Unlike Confluence, there's no shared-space requirement — each new doc is shared
"anyone with the link can edit" right after creation, so no destination folder needs to be set up
first.

One-time admin setup:
1. Create (or reuse) a GCP project; enable the **Google Drive API**.
2. Create a service account; generate a JSON key.
3. Set `GOOGLE_SERVICE_ACCOUNT_EMAIL` (the key's `client_email`) and
   `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` (the key's `private_key`, keep the `\n` escapes). These
   string vars are what the **deployed** container uses — Astropods secrets/vars don't support
   mounting files.
4. Optional: create a Drive folder and set `GOOGLE_DRIVE_FOLDER_ID` to file new docs under it
   instead of the service account's own Drive root — purely organizational, not required for
   access.

For **local dev only**, you can instead set `GOOGLE_APPLICATION_CREDENTIALS` to the path of the
downloaded JSON key file and skip the two vars above — Quill reads `client_email`/`private_key`
straight out of it. This is the same convention Google's own client libraries use, and what the
`devrel-claude-code-skills` `meetup-calendar` skill does. It won't work once deployed, since that
file path won't exist on the container.

Reading Google Docs uses the same service account and the Drive API. Share each private source
document or its parent folder with the service-account email as **Viewer**. Public link sharing
is not required. Quill can only read files accessible to that account, and currently supports
Google Docs content (not PDFs, Sheets, or Slides).

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
| `CONFLUENCE_BASE_URL` | optional | Defaults to `https://postmanlabs.atlassian.net/wiki` |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | for Google Docs | Service account `client_email` — used to read and create Google Docs. Required for deployment. |
| `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` | for Google Docs | Service account `private_key` (keep the `\n` escapes). Required for deployment. |
| `GOOGLE_APPLICATION_CREDENTIALS` | local-dev alternative | Path to the service account JSON key file — reads the two vars above out of it. **Local dev only**, not usable once deployed. |
| `GOOGLE_DRIVE_FOLDER_ID` | optional | Drive folder new docs are filed under. Purely organizational — every doc is shared "anyone with the link can edit" on creation regardless. |

Postman DevRel-specific constants are baked into the code:

- **Confluence destination** — space `Quill`, parent page `8244560849` ([`agent/lib/confluence.ts`](agent/lib/confluence.ts))
- **Jira header tickets** — project `MKTG`, issue type `Task`, `Marketing Team = Creative`, base URL derived from `CONFLUENCE_BASE_URL`, no auto-assignee ([`agent/lib/jira.ts`](agent/lib/jira.ts))

Intentionally **not exposed as env vars** — change the defaults in code and redeploy if they need to move.

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
ast secrets create GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY   # only if Google Doc drafts are enabled

# 3. Deploy — secrets via @ shorthand, non-secret vars passed literally
ast deploy @postman/quill \
  --var TAVILY_API_KEY=@ \
  --var WP_USERNAME=@ \
  --var WP_APP_PASSWORD=@ \
  --var CONFLUENCE_API_TOKEN=@ \
  --var CONFLUENCE_EMAIL=service.quill@postman.com \
  --var CONFLUENCE_SPACE_KEY=Quill \
  --var GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY=@ \
  --var GOOGLE_SERVICE_ACCOUNT_EMAIL=quill-bot@your-project.iam.gserviceaccount.com \
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
    ├── tools/                 # tool definitions
    └── lib/
        ├── anthropic.ts       # @anthropic-ai/sdk wrapper
        ├── confluence.ts      # Confluence REST client (service account)
        ├── google-drive.ts    # Drive API client (service account) — authenticated reads and writes
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

## Video → SEO/AEO blog

Quill turns a **video transcript** into an SEO/AEO article. The transcript comes from a public
**YouTube** video's captions, a **Loom** share link's transcript, or text you paste into the chat.
Claude uses Quill's Postman writing guidance to produce a standalone article. Only the spoken
words are used: code, UI, or terminal output that is shown but never said will not appear, and
auto-generated captions can misspell product names. Review technical claims before publishing.

Example prompts:

```text
Turn https://www.youtube.com/watch?v=VIDEO_ID into an SEO/AEO blog for API developers.
Write a blog from this Loom: https://www.loom.com/share/<id>
Write a blog from this transcript: <pasted text>
```

### Setup

Quill needs only its existing `ANTHROPIC_API_KEY`. Loom and (by default) YouTube transcripts are
fetched from the same public endpoints their web players use, with no API key. YouTube blocks that
keyless fetch from cloud IPs, so for videos on a channel you manage, add the optional
`YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET` and `YOUTUBE_REFRESH_TOKEN` (see below). When all three
are set Quill uses the official YouTube Data API first and falls back to the keyless fetch.
Saving the resulting article to Google Docs uses the Drive service account as usual.

#### YouTube OAuth setup

1. In Google Cloud, enable **YouTube Data API v3** and create an **OAuth client ID** (type: Web
   application) with redirect URI `https://developers.google.com/oauthplayground`. Set the consent
   screen to **Internal** (Workspace) or **In production**; refresh tokens for apps left in
   "Testing" expire after 7 days.
2. At [OAuth Playground](https://developers.google.com/oauthplayground), open the settings gear, tick
   **Use your own OAuth credentials**, and enter the client ID and secret. Authorize the scope
   `https://www.googleapis.com/auth/youtube.force-ssl` while signed in as an account with edit access
   to the channel, then exchange the code and copy the **refresh token**.
3. Store them: `ast secrets set YOUTUBE_CLIENT_ID ...`, `YOUTUBE_CLIENT_SECRET`, `YOUTUBE_REFRESH_TOKEN`.

The API only downloads captions for videos that account owns or can edit; other videos fall back to
the keyless fetch, then to pasting the transcript.

`video_to_blog` does everything in one call (about a minute): it fetches the transcript, has Claude
write the article, and saves it to **Confluence**, then Quill replies with the page link and the
review notes (likely caption errors, on-screen details to verify). There is nothing to check back
on. If the Confluence save fails, Quill still returns the draft. Ticket creation and WordPress
staging remain separate requests.

### Limits and fallbacks

- Those endpoints are undocumented and can change. If a fetch fails, Quill asks you to paste the
  transcript (Loom: Transcript tab → copy; YouTube: ⋯ → Show transcript → copy).
- YouTube videos must be public and have captions. Loom links must be public and transcribed;
  private, workspace-only, or password-protected Looms need a pasted transcript.
- Transcripts over 120,000 characters are rejected; split them.
- Transcript text is treated as source material, not instructions for tools or publication.
- SEO/AEO suggestions are editorial metadata, not measured search volumes or ranking guarantees.
- Nothing is stored locally: no job files or volume are needed.

### Verification

```bash
# Inside the running container (network calls mocked):
docker exec quill-agent-1 bun test agent/video/video.test.ts agent/lib/google-drive.test.ts
```

Mocked tests do not verify the live YouTube/Loom endpoints; try a real link after deploying.
