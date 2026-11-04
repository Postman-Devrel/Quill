---
name: Quill
description: Slack-first blog pipeline agent for Postman DevRel. Drop a topic, Google Doc, Confluence page, or YouTube/Loom video and Quill drafts, copy-edits, saves, files a Jira header ticket, and stages to WordPress as a draft — a human editor schedules and publishes.
tags: [blog, content, devrel, writing, wordpress, confluence, jira, google-docs, video, youtube, loom, publishing, slack]
authors: [pmmistry]
---

# Quill 🪶

> *From idea to live post, without leaving Slack.*

Quill is the Postman DevRel content-pipeline agent for [blog.postman.com](https://blog.postman.com), accessible from Slack on Astropods. One conversation replaces four tools: research → draft → copy-edit → save to Confluence → open a Jira header-image ticket → stage to WordPress as a draft. Quill never publishes — a human editor schedules and publishes from WP admin. Quill also reads existing Confluence pages and Google Docs, so you can drop a link and ask for a copy-edit, a header-image ticket, or a fresh post built from it, and it can turn a YouTube or Loom video into an SEO/AEO blog from the transcript.

---

## What Quill does

| Trigger | Workflow |
|---|---|
| "write me a blog about X" | Coverage check → research → write → save to Confluence → return markdown + Confluence link |
| "copy-edit this" | Quill asks for the edit level first — **grammar** (proofread only), **SEO/AEO only** (frontmatter metadata, body untouched), or **full** — then saves the edited version and returns changes and flagged risky rewrites. Handles drafts up to ~15K words |
| "create a header ticket for this draft: `<confluence URL>`" | Read Confluence page → file Jira ticket in MKTG (`Header image request for blog: <title>`) with a link back to the draft |
| "stage this to WordPress" | Frontmatter-driven WP draft — auto-tags, Yoast SEO, upserts if the title already exists. Always `status=draft`. Refuses to stage without `meta_description`, `primary_keyword`, and `answer_summary`; runs the SEO/AEO-only pass first when they are missing |
| "when could this go live?" | Informational — surfaces the next open Tue/Thu 8am-PT slots. Cannot schedule |
| "what should I write about?" | Parallel web search → 8–12 scored ideas by urgency tier → saved to Confluence |
| Paste a Confluence URL | Routes to copy-edit / write / brainstorm / header-ticket based on what you ask |
| Paste a Google Docs URL | Read the doc (shared with Quill's service account as Viewer) → copy-edit / write / stage to WordPress. Drafts can also be saved to a new Google Doc instead of Confluence |
| "turn this video into a blog" + YouTube / Loom URL or pasted transcript | Fetch transcript → Claude writes an SEO/AEO article from the spoken words only → save to Confluence → reply with the page link and review notes |
| "address the comments on `<confluence URL>`" | Read inline + footer comments → apply clear edits to the page in place → reply on each comment; ambiguous ones are raised with you |
| "how did last week's posts perform?" / "top posts this month" | Read-only WordPress (Jetpack) Stats — views and visitors, top posts, per-post performance, traffic sources. Page views only; no Google Analytics, conversions, or engagement data |
| "update ticket `MKTG-123`" | Edit author, summary, draft link, due date, assignee, labels, add a comment, or move status |

---

## Tool catalog

20 tools. Four make dedicated Claude calls with their own system prompts (`video_to_blog` does so inside its pipeline); the rest are pure API wrappers. **All WordPress interaction is stage-only.**

| Tool | LLM | Purpose |
|---|---|---|
| `web_search` | ❌ | Tavily web search |
| `check_blog_coverage` | ❌ | Search blog.postman.com to avoid duplicates |
| `write_draft` | ✅ | 1200–1600 word draft with SEO frontmatter (Postman voice, banned-word enforcement) |
| `copyedit_draft` | ✅ | Three modes (`grammar`, `seo_only`, `full`). Returns auto-applied `changes` + flagged risky rewrites (`flags`). Sized for drafts up to ~15K words |
| `blog_ideas` | ✅ | Score 8–12 ideas across 5 weighted criteria |
| `video_to_blog` | ✅ | Transcript (YouTube, Loom, or pasted) → SEO/AEO article → Confluence page, in one call (~1 minute). Spoken words only; returns review notes |
| `save_to_confluence` | ❌ | Create a Confluence page from markdown |
| `read_confluence` | ❌ | Read a Confluence page back as markdown |
| `read_confluence_comments` | ❌ | Read all inline + footer comments on a page, with resolution status and anchored text |
| `update_confluence_page` | ❌ | Overwrite an existing page in place with revised markdown (prior version stays in page history) |
| `reply_confluence_comment` | ❌ | Reply to a comment after applying its change |
| `read_google_doc` | ❌ | Read a Google Doc as markdown via the Drive service account (Docs only) |
| `save_to_google_doc` | ❌ | Save a markdown draft as a new Google Doc, shared "anyone with the link can edit" |
| `create_header_request` | ❌ | File a Jira ticket in MKTG with a link to the Confluence draft |
| `update_jira_ticket` | ❌ | Edit an existing ticket's fields, add a comment, or move its status |
| `stage_to_wordpress` | ❌ | Create/update a WordPress draft (always `status=draft`; requires SEO/AEO metadata) |
| `find_next_wp_slot` | ❌ | Informational — next open Tue/Thu publish slots |
| `list_wp_schedule` | ❌ | Editorial calendar views |
| `wp_publish_stats` | ❌ | Publish counts by date range |
| `blog_analytics` | ❌ | Read-only traffic performance from WordPress (Jetpack) Stats: site views/visitors, top posts, per-post and recently-published post performance, referrers, search terms |

### Video sources

`video_to_blog` accepts one of three inputs. Only the spoken words are used — code, UI, or terminal output shown on screen but not said will not appear, and auto-captions can misspell product names, so review technical claims before publishing.

| Source | How it is read | Limits |
|---|---|---|
| **Loom** | Public Loom transcript endpoint | The link must be public (set it to expire if you want it temporary). Private, workspace-only, or password-protected Looms need a pasted transcript |
| **YouTube** | YouTube Data API v3 with an OAuth refresh token, then a keyless fallback | The API only downloads captions for videos on channels the authorized account owns or manages (currently the Postman channel). YouTube blocks the keyless fetch from cloud IPs, so other videos need a pasted transcript |
| **Pasted transcript** | Used as-is | Works for anything |

Transcripts over 120,000 characters are rejected. YouTube's rolling auto-captions are de-duplicated before drafting. If a fetch fails, Quill says why and asks for a pasted transcript.

---

## Architecture

**Hybrid Mastra + per-tool Claude calls.** Top-level Mastra agent (`agent/index.ts`) routes conversation and streams to Slack via `MastraAdapter` + `serve()` from `@astropods/adapter-core`. Tools needing their own cognition (`write_draft`, `copyedit_draft`, `blog_ideas`) make direct `@anthropic-ai/sdk` calls with dedicated system prompts — keeping drafting, editing, and idea-scoring prompts isolated. `video_to_blog` runs a small pipeline in `agent/video/` (transcript → Claude article → Confluence) so the user gets a link in one call. The rest are pure API wrappers around WordPress, Confluence, Jira, Google Drive, Tavily, and in-process scheduling logic.

```
Slack → Astropods messaging sidecar → MastraAdapter
        → Quill agent (top-level Claude routing)
            ├── pure API tools (WP, Confluence, Jira, Google Drive, Tavily)
            ├── per-tool Claude calls (write_draft, copyedit_draft, blog_ideas)
            └── video pipeline (YouTube / Loom / pasted transcript → article → Confluence)
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
| `CONFLUENCE_BASE_URL` | optional | Defaults to `https://postmanlabs.atlassian.net/wiki` |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` / `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` | optional | Google Cloud service account (Drive API) for reading and creating Google Docs. Share source docs or folders with the service-account email as Viewer. Local dev can use a JSON key file instead; that does not work once deployed |
| `YOUTUBE_CLIENT_ID` / `YOUTUBE_CLIENT_SECRET` / `YOUTUBE_REFRESH_TOKEN` | optional | OAuth client and refresh token (scope `youtube.force-ssl`) for downloading captions via the YouTube Data API. Without all three, Quill falls back to the keyless caption fetch, which YouTube blocks from cloud IPs |

Postman DevRel-specific constants are baked into the code:

- Confluence destination: space `Quill`, parent page `8244560849` — [`agent/lib/confluence.ts`](agent/lib/confluence.ts)
- Jira header tickets: project `MKTG`, issue type `Task`, `Marketing Team = Creative`, base URL derived from `CONFLUENCE_BASE_URL` — [`agent/lib/jira.ts`](agent/lib/jira.ts)

Intentionally not exposed as env vars — change the defaults in code and redeploy if they need to move.

### YouTube OAuth setup

An API key cannot download captions; the Data API requires OAuth, and only for videos the authorized account can edit.

1. In Google Cloud, enable **YouTube Data API v3** and create a **Web application** OAuth client with redirect URI `https://developers.google.com/oauthplayground`.
2. Set the consent screen's publishing status so the token doesn't expire: apps left in **Testing** have refresh tokens that expire after 7 days. Publishing needs app name, support email, home page, and privacy policy URLs on the Branding page. While in Testing, add your account under Audience → Test users.
3. In [OAuth Playground](https://developers.google.com/oauthplayground), use your own OAuth credentials (cog icon), set Access type to Offline, authorize `https://www.googleapis.com/auth/youtube.force-ssl`, and **choose the channel Quill should act as** (e.g. the Postman Brand Account) on the consent screen. The channel picked there is baked into the token.
4. Exchange the code for tokens and store the refresh token. Test it against Google before deploying: exchange it for an access token, check `channels?mine=true` returns the intended channel, and download a caption track.

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
ast push --allow-dirty                      # drop --allow-dirty once changes are committed
ast secrets create TAVILY_API_KEY WP_USERNAME WP_APP_PASSWORD CONFLUENCE_API_TOKEN

ast deploy @postman/quill \
  --var TAVILY_API_KEY=@ --var WP_USERNAME=@ --var WP_APP_PASSWORD=@ \
  --var CONFLUENCE_API_TOKEN=@ \
  --var CONFLUENCE_EMAIL=service.quill@postman.com \
  --var CONFLUENCE_SPACE_KEY=Quill \
  --adapter web --adapter slack --name "Quill" --wait
```

Then connect Slack in the Astro dashboard: deployed agent → Integrations → Slack → connect workspace.

### Updating a running agent

```bash
ast push --allow-dirty                      # prints the new build ID
ast agent redeploy --id <deployment-id> --build <build-id> \
  --var YOUTUBE_CLIENT_ID=<client-id> --var YOUTUBE_CLIENT_SECRET=@ --var YOUTUBE_REFRESH_TOKEN=@
```

Gotchas learned the hard way:

- **Declaring an input in `astropods.yml` and creating the secret did not make the container use OAuth.** After the first redeploy, runs went straight to the keyless clients with no `[transcript] YouTube OAuth failed…` log line, which means the three `YOUTUBE_*` values weren't reaching the container (the pushed image did contain the code). The redeploy was repeated with the values bound via `--var`; whether that is what fixes it was not yet confirmed when this was written. If the OAuth log line still never appears after a failed run, the variables aren't arriving.
- Create secrets with `ast secrets create NAME --env main --value …` (there is no `set`). `--env main` scopes a value to Quill instead of the shared account vault.
- `ast build` followed by `ast push --no-build` can fail on a mismatched image tag; run `ast push` on its own so it builds and pushes consistently.
- Container logs are the quickest signal: `ast agent logs --id <id> --workload quill-agent`. Per-run output is under `ast agent trace --id <id>`.
- The previous good build can be restored with `ast agent redeploy --id <id> --build <old-build-id>`.

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
    ├── tools/                 # 19 tool definitions
    ├── video/                 # video_to_blog pipeline: transcript (YouTube OAuth, Loom, paste), draft, pipeline, tests
    └── lib/
        ├── anthropic.ts       # @anthropic-ai/sdk wrapper
        ├── confluence.ts      # Confluence REST client
        ├── google-drive.ts    # Drive API: read and create Google Docs
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
- **YouTube works only for channels the authorized account manages.** Anything else needs a pasted transcript. A transcript-API service would remove that limit but adds a paid or capped dependency.
- **YouTube refresh tokens expire after 7 days while the OAuth app is in Testing.** Publish the app (or ask a Workspace admin about Internal) so the token lasts; when it expires, Quill logs the reason and falls back to the keyless fetch.
- **Loom links must be public.** Private, workspace-only, and password-protected videos need a pasted transcript.
- **Google Docs only.** Sheets, Slides, and other Drive files are not read.
- **`scan_prod_updates` not built yet** — pulling Postman #product-updates into a blog-ready brief is on the roadmap and will need a Slack bot token.
- **Slack adapter is platform-managed** — the agent never sees a Slack bot token unless `scan_prod_updates` adds one.
