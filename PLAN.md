# Quill — Slack Blog Pipeline Agent
## Build Plan, System Design & Claude Code Prompts

---

## Agent Name: Quill 🪶

**Tagline:** *From idea to live post, without leaving Slack.*

The name reflects writing, publishing, and the idea of a single tool that does the whole job. Short, memorable, fitting for a DevRel context.

---

## The Core Problem: Stateless Cloud vs. File-Based Skills

Your boss identified the key architectural challenge immediately. The original `blog-agent` skills assume a local filesystem (`blog-output/*.md`, temp files, etc.). Astro AI is stateless — no persistent disk between invocations.

**The solution: Conversational context as the state machine.**

Instead of passing filenames between skills, Quill passes the actual content through Slack thread context. Each pipeline stage reads the last message in the thread as its input. This answers your boss's questions:

- *"Can you chain agentic calls?"* → Yes. Each skill call appends its full output to the Slack thread. The next skill reads the thread history via `client.getThreadHistory()`.
- *"Does it work to paste output of /blog-write into /blog-copyedit?"* → Yes, exactly — the thread IS the clipboard. No pasting required.
- *"What about the filesystem?"* → We replace file writes with: (1) Google Drive for final drafts, (2) WordPress REST API for staging, (3) Slack thread for in-flight state.

The **outcome measure** is a live URL to a scheduled WordPress post — surfaced in Slack when the pipeline completes.

---

## System Architecture

```
Slack User
    │
    │  @quill write a blog about MCP servers
    ▼
Slack (Astro messaging sidecar)
    │
    │  gRPC / @astropods/messaging
    ▼
Quill Agent Container (Node.js / TypeScript)
    │
    ├── Pipeline Router (intent detection)
    │       │
    │       ├── WRITE stage → Claude API (blog-write skill prompt)
    │       │                      │
    │       │                      └── Tavily API (web research)
    │       │
    │       ├── COPYEDIT stage → Claude API (blog-copyeditor prompt)
    │       │
    │       ├── GDRIVE stage → Google Drive API (save .md to Drive)
    │       │
    │       ├── PIPELINE stage → orchestrates all of the above
    │       │
    │       └── SCHEDULE stage → WordPress REST API
    │
    └── Thread State Manager (reads Slack thread history as context)

External APIs:
  - Anthropic API (claude-sonnet-4-6)
  - Tavily API (web search for blog research)
  - Google Drive API (save drafts)
  - WordPress REST API (blog.postman.com staging + scheduling)
```

---

## Architecture (chosen: hybrid Mastra)

- Top-level **Mastra agent** handles routing, conversation memory, Slack streaming
- Two tools (`write_draft`, `copyedit_draft`) make their **own dedicated Claude API calls** with the full original SKILL.md prompts as system prompts — preserves prompt isolation
- All other tools are **pure API wrappers** (no LLM)
- The blog-pipeline orchestration lives in `agent/instructions.ts` — Quill *learns* the pipeline, no separate orchestrator file

## Repo Structure

```
Quill/
├── Dockerfile
├── astropods.yml
├── AGENT.md
├── PLAN.md
├── package.json
├── tsconfig.json
├── .env.example
└── agent/
    ├── index.ts                       # Mastra agent + serve()
    ├── instructions.ts                # Quill's top-level system prompt (THE orchestrator)
    ├── prompts/
    │   ├── blog-write.md              # ported from skills/blog-write/SKILL.md
    │   └── copyedit.md                # ported from skills/blog-copyeditor/SKILL.md
    ├── tools/
    │   ├── index.ts                   # re-exports
    │   ├── web-search.ts              # web_search (Tavily)
    │   ├── write-draft.ts             # write_draft (Claude call)
    │   ├── copyedit-draft.ts          # copyedit_draft (Claude call)
    │   ├── save-to-drive.ts           # save_to_drive
    │   ├── wordpress-stage.ts         # stage_to_wordpress (+ media + tags helpers)
    │   ├── wordpress-schedule.ts      # find_next_wp_slot + reschedule_wp_post
    │   ├── wordpress-list.ts          # list_wp_schedule
    │   ├── wordpress-stats.ts         # wp_publish_stats
    │   ├── gdoc-import.ts             # import_from_gdoc
    │   ├── blog-ideas.ts              # blog_ideas
    │   └── prod-updates.ts            # scan_prod_updates
    └── lib/
        ├── anthropic.ts               # @anthropic-ai/sdk wrapper for tool-internal calls
        ├── tavily.ts                  # Tavily client
        ├── wordpress.ts               # WP REST API client + scheduling rules + holidays
        ├── google.ts                  # Google Docs + Drive client
        ├── slack.ts                   # Slack Web API client (for prod-updates only)
        └── markdown.ts                # marked + frontmatter helpers
```

## Skills → Tools Coverage Matrix

| Skill | Quill tool(s) | Notes |
|---|---|---|
| `blog-write` | `write_draft` + `web_search` | Tool calls Claude with blog-write system prompt |
| `blog-ideas` | `blog_ideas` (uses `web_search`) | No dedup memory in v1 (stateless deferred) |
| `blog-copyeditor` | `copyedit_draft` | Returns `{editedDraft, seoTitle, metaDescription, changes[]}` |
| `blog-pipeline` | **agent/instructions.ts** | Mastra agent learns the chain; no separate tool |
| `blog-create-from-gdoc` | `import_from_gdoc` | Google Docs API → markdown + images |
| `blog-wordpress-scheduler` | `list_wp_schedule` + `reschedule_wp_post` + `find_next_wp_slot` | Tue/Thu rules + US holidays embedded in lib/wordpress.ts |
| `blog-wordpress-stage` | `stage_to_wordpress` (+ internal `upload_wp_media`, `get_or_create_wp_tags`) | Full create-or-update with featured image, tags, SEO meta |
| `blog-wordpress-stats` | `wp_publish_stats` | Date range → counts + monthly breakdown |
| `blog-prod-updates` | `scan_prod_updates` | Slack `conversations.history`; no dedup memory in v1 |
| (Quill-specific) | `save_to_drive` | Archive final draft as Google Doc; not from existing skills |

## State Persistence (Deferred to v2)

Three skills in their local form maintain JSON state files:
- `dashboard/ideas.json` — blog ideas dedup
- `dashboard/wp-calendar.json` — WP calendar mirror
- `blog-output/.prod-update-memory.json` — Slack prod-update dedup

Astropods is stateless, so these don't translate. **Decision: skip state in v1.** Tools run fresh each invocation:
- `blog_ideas` may surface the same idea twice across runs (Slack thread context partially mitigates)
- `scan_prod_updates` may re-cover the same shipped feature
- `list_wp_schedule` queries WordPress live, no calendar JSON needed

**v2 plan:** add `knowledge: { cache: { provider: redis } }` to astropods.yml; tools use `REDIS_URL` for dedup keys.

---

## astropods.yml

```yaml
spec: blueprint/v1
name: quill-blog-agent

agent:
  build:
    context: .
    dockerfile: Dockerfile
  interfaces:
    messaging: true
  inputs:
    - name: ANTHROPIC_API_KEY
      datatype: string
      secret: true
      description: Anthropic API key for Claude
    - name: TAVILY_API_KEY
      datatype: string
      secret: true
      description: Tavily API key for web search
    - name: WP_USERNAME
      datatype: string
      secret: true
      description: WordPress username for blog.postman.com
    - name: WP_APP_PASSWORD
      datatype: string
      secret: true
      description: WordPress application password
    - name: GOOGLE_SERVICE_ACCOUNT_JSON
      datatype: string
      secret: true
      description: Google service account JSON for Drive access
    - name: GDRIVE_FOLDER_ID
      datatype: string
      description: Google Drive folder ID for blog drafts

dev:
  interfaces:
    messaging:
      adapters: [slack, web]
      slack:
        auto_thread: true
  command: bun --watch src/index.ts
```

---

## Dockerfile

```dockerfile
FROM oven/bun:1-alpine AS base
WORKDIR /app

FROM base AS deps
COPY package.json bun.lockb ./
RUN bun install --frozen-lockfile --production

FROM base AS runner
COPY --from=deps /app/node_modules ./node_modules
COPY src ./src
COPY prompts ./prompts
COPY tsconfig.json ./

ENV NODE_ENV=production
EXPOSE 9090

CMD ["bun", "src/index.ts"]
```

---

## Pipeline Stages: How Conversational Context Works

### Stage 1 — Write (`/write <topic>`)

1. User says: `@quill write a blog about MCP servers and Postman`
2. Quill detects intent → `WRITE` stage
3. Sends `THINKING` status to Slack
4. Calls Claude with the blog-write system prompt + topic + Tavily research results
5. Streams the full markdown draft back to the Slack thread
6. Posts a suggested prompt button: `"Copy-edit this draft"`

### Stage 2 — Copy-edit (`/copyedit`)

1. User clicks the button or says `@quill copy-edit this`
2. Quill calls `getThreadHistory()` to get the previous message (the draft)
3. Sends to Claude with the copyeditor system prompt
4. Streams the edited draft + SEO title + meta description back to thread
5. Posts: `"Save to Google Drive"` and `"Run full pipeline"` buttons

### Stage 3 — Save to Drive (`/save`)

1. User clicks `"Save to Google Drive"`
2. Quill takes the copyedited draft from thread history
3. Calls Google Drive API to create a new `.md` file in the team Drive folder
4. Posts the Drive URL back to Slack

### Stage 4 — Stage to WordPress (`/stage`)

1. User says `@quill stage this to WordPress`
2. Quill reads the copyedited content + SEO metadata from the thread
3. Calls WordPress REST API to create a draft post with the title, content, meta description, and tags
4. Posts the WordPress draft URL back to Slack

### Stage 5 — Schedule (`/schedule`)

1. User says `@quill schedule this for next Tuesday`
2. Quill reads the WP draft ID from the thread context
3. Applies Tue/Thu-first scheduling logic
4. Updates the WP post status to `future` with the publish date
5. Posts: `"✅ Scheduled for Tuesday June 30 at 8am PST"` with the WP admin link

### Full Pipeline (`/pipeline <topic>`)

Runs all of the above autonomously. Posts status updates after each stage:
- `📝 Writing draft...`
- `✂️ Copy-editing...`
- `📁 Saving to Drive...`
- `📤 Staging to WordPress...`
- `📅 Scheduled for [date]`
- `🎉 Live post: [URL]` (the outcome metric)

---

## Build Order (pipeline-critical first)

| # | Step | Tool(s) | LLM call? | Skill source |
|---|---|---|---|---|
| 1 | ✅ Scaffold | package.json, tsconfig, astropods.yml, agent/index.ts echo | n/a | — |
| 2 | Build web_search | `web_search` | no | shared dep |
| 3 | Build write_draft | `write_draft` | yes (dedicated Claude call w/ blog-write prompt) | blog-write |
| 4 | Build copyedit_draft | `copyedit_draft` | yes (dedicated Claude call w/ copyedit prompt) | blog-copyeditor |
| 5 | Build save_to_drive | `save_to_drive` | no | (Quill-specific) |
| 6 | Build stage_to_wordpress | `stage_to_wordpress` (+ internal `upload_wp_media`, `get_or_create_wp_tags`) | no | blog-wordpress-stage |
| 7 | Build scheduling tools | `find_next_wp_slot`, `reschedule_wp_post` | no | blog-wordpress-scheduler |
| 8 | Build list_wp_schedule | `list_wp_schedule` | no | blog-wordpress-scheduler |
| 9 | Build import_from_gdoc | `import_from_gdoc` | no | blog-create-from-gdoc |
| 10 | Build blog_ideas | `blog_ideas` (uses `web_search`) | yes (scoring) | blog-ideas |
| 11 | Build wp_publish_stats | `wp_publish_stats` | no | blog-wordpress-stats |
| 12 | Build scan_prod_updates | `scan_prod_updates` | no | blog-prod-updates |
| 13 | Write full instructions.ts | teach Quill the pipeline + each workflow | n/a | blog-pipeline |
| 14 | Write AGENT.md + Dockerfile | deployment metadata | n/a | — |
| 15 | Local test (`ast project start`) | smoke test end-to-end | n/a | — |
| 16 | Deploy to Astro AI | `ast blueprint push` + `deploy` | n/a | — |

After step 6 we have a **demoable MVP**: research → write → copyedit → drive → WP staging. Each subsequent step adds capability without breaking the chain.

---

## Key Decisions & Trade-offs

| Decision | Choice | Rationale |
|---|---|---|
| State management | Slack thread history | No DB needed; natural UX; thread IS the conversation |
| File system | None — Drive + WP API | Stateless-safe; files live in the cloud |
| Skill execution | Direct Claude API calls | No Claude Code CLI dependency in prod; portable |
| Streaming | Yes, token-by-token | Long drafts need progress visibility in Slack |
| Scheduling logic | In-process TypeScript | No external deps; easy to adjust rules |
| WordPress auth | Application Password | Safest WP REST auth pattern |

---

## Secrets to Configure in Astro AI

```
ast secrets set TAVILY_API_KEY tvly-...
ast secrets set WP_USERNAME your-wp-username
ast secrets set WP_APP_PASSWORD "xxxx xxxx xxxx xxxx xxxx xxxx"
ast secrets set GOOGLE_SERVICE_ACCOUNT_JSON '{"type":"service_account",...}'
ast secrets set GOOGLE_DRIVE_FOLDER_ID 1abc...
ast secrets set SLACK_BOT_TOKEN xoxb-...   # for scan_prod_updates only
```

(`ANTHROPIC_API_KEY` is auto-injected by the platform via `models.anthropic.provider: anthropic` in astropods.yml — don't set manually.)

---

## Success Metric

```
🎉 Done!

*"How Postman Makes MCP Server Testing Easy"* is scheduled.

📄 Draft → https://drive.google.com/...
📤 WP Preview → https://blog.postman.com/?p=12345&preview=true
📅 Publishing → Tuesday, July 1 at 8:00 AM PST
```

That live post URL is the outcome. Everything else is process.
