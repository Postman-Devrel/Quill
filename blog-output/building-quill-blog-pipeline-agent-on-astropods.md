---
suggested_title: "Building a Blog Pipeline Agent on Astropods"
meta_description: "How I built Quill, a Slack-first blog pipeline agent, on Astropods with Mastra and the Claude API. The real architecture, gotchas, and deploy steps."
seo_score: 88
seo_notes:
  - "Primary keyword in title, intro, and multiple H2s"
  - "Heading hierarchy is clean, sections are short and scannable"
  - "Links to Astropods, Mastra, and the Claude API docs throughout the body"
primary_keyword: "blog pipeline agent"
secondary_keywords: ["Astropods", "Mastra agent", "Claude API", "Slack agent"]
author: "Pooja Mistry"
---

# Building a Blog Pipeline Agent on Astropods

Publishing a blog post for Postman DevRel used to mean bouncing between four tools. I would draft somewhere, copy-edit somewhere else, drop the draft into Confluence for the team, open a Jira ticket so design could make a header image, and finally stage the post to WordPress. Every handoff was a copy, a paste, and a chance to forget a step.

So I built Quill: a blog pipeline agent that runs the whole thing from one Slack conversation. Drop a topic, and Quill checks whether we have already covered it, drafts in Postman's voice, copy-edits for grammar and SEO, saves both versions to Confluence, files the Jira header ticket, and stages the post to WordPress as a draft. It never publishes. A human editor still owns the schedule.

This is the story of how it came together, including the parts that fought me.

## The problem that shaped everything

My first instinct was to port the blog skills I already had. Those skills were built for the Claude Code CLI, and they assume a filesystem. They write to `blog-output/*.md`, read style guides off disk, and pass filenames between steps.

Astropods runs agents as stateless containers. There is no durable disk between invocations, and no clipboard between steps. That single constraint reframed the whole design.

The answer was to stop passing files and start passing content. The Slack thread is the state machine. Each stage reads the conversation context as its input, and the agent carries the active draft in memory for the next tool call. No temp files, no filenames, no "which version was that again." The measurable outcome is a WordPress draft URL that shows up in Slack when the pipeline finishes.

## Picking the stack

Quill sits on three pieces:

- [Astropods](https://astropods.com) for the platform. It handles the Slack connection, the messaging sidecar, and deployment.
- [Mastra](https://mastra.ai) for the agent runtime and tool orchestration.
- The [Claude API](https://docs.anthropic.com/en/api/overview) for the writing, editing, and idea-scoring that actually needs cognition.

The design is a hybrid. A top-level Mastra agent routes the conversation and streams to Slack. Most of the twelve tools are plain REST wrappers around WordPress, Confluence, Jira, and Tavily. Only three tools make their own Claude calls with dedicated system prompts: `write_draft`, `copyedit_draft`, and `blog_ideas`. Keeping those prompts isolated means the drafting instructions never bleed into the editing instructions.

```
Slack → Astropods messaging sidecar → MastraAdapter
        → Quill agent (top-level Claude routing)
            ├── pure API tools (WordPress, Confluence, Jira, Tavily)
            └── per-tool Claude calls (write_draft, copyedit_draft, blog_ideas)
```

## The gotchas that cost me the most time

Here is where the build stopped being tidy.

### Mastra caps the agentic loop at 5 steps

Mastra's default `maxSteps` is 5. A single Quill workflow (write, save to Confluence, file a Jira ticket, stage to WordPress) is already four steps. Brainstorming with parallel research blows past five easily. The agent would just stop mid-pipeline with no obvious error.

`MastraAdapter` does not expose `maxSteps`, and there is no constructor option for it. The clean fix was to proxy the agent and inject the limit on every `stream()` call:

```typescript
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
```

One detail there is not optional. You have to bind every function back to the original `target`. The Mastra agent uses private class fields, and an unbound proxy throws `TypeError: Cannot access invalid private field` the moment those fields are touched.

### Claude Code skill files are not portable to the API

I assumed I could feed my existing `SKILL.md` files straight into an API call as the system prompt. That breaks. Those files instruct the model to use Claude Code tools like `WebSearch` and `Read`. Sent to the API, Claude tries to emit those tool calls as XML, which corrupts any JSON parser waiting downstream.

The fix is a small loader (`agent/lib/skill-md.ts`) that reads each `SKILL.md`, strips the frontmatter, and removes the sections that assume a local runtime: Input Handling, Writing Style Guide, Research Phase, Post-Write, and Behavior Modes. What survives is the good part: voice, tone, content structure, SEO rules, and scoring rubrics. Quill then prepends its own strict output format on top so the JSON schema always wins.

That split turned out to be the right mental model for the whole project. Hardcode the output contract in code. Pull the voice and judgment from the skills.

### JSON tools need to be told "no tool calls"

Even with a JSON output format spelled out, Claude would occasionally try to emit a tool call if the system prompt mentioned tools at all. The reliable cure was a blunt instruction at the end of those prompts: return only the JSON object, no tool calls, no file writes, no explanations.

### Caching and right-sizing the model calls

Two changes made Quill feel fast instead of sluggish.

First, [prompt caching](https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching). The stripped skill content is a large system prompt, and reprocessing it on every call is wasteful. Marking it as cacheable cuts time to first token dramatically on repeated calls in a session:

```typescript
system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }]
```

Second, right-sizing each call instead of using one big number everywhere. Claude generates up to the token budget you give it, so `blog_ideas` (pure JSON scoring) runs on a faster model at a low temperature, while `write_draft` keeps the creative headroom. Editing and scoring want low temperature for reliably valid JSON. Drafting wants the opposite.

### Docker bakes your skills into the image

This one bit me again recently, so it earns a spot. Quill's `Dockerfile` copies the skills folder into the image at build time:

```dockerfile
COPY agent/ ./agent/
COPY skills/ ./skills/
```

During local dev, `bun --watch` hot-reloads code edits in `agent/` instantly, which lulls you into thinking everything is live. It is not. The `skills/` folder is baked. I updated a skill file, watched the code reload, and then spent a minute confused about why the change had no effect. The container was reading the version from the last image build.

The rule is simple once you know it. Code edits hot-reload. Anything in a `COPY` layer, or a change to `astropods.yml` or dependencies, needs a rebuild:

```bash
ast project start --rebuild --background
```

## Keeping a human in the loop on purpose

Two decisions were about restraint, not capability.

WordPress is staging only. Quill creates every post as `status: draft` and never schedules or publishes. Timing is an editorial call, so a person sets the date in WP admin. Quill can surface the next open publish slots as guidance, but it cannot act on them.

Confluence and Jira both run through one shared service-account identity. A single Atlassian API token authorizes page creation and ticket creation, so there is one auth for the whole team and every draft and ticket is owned by the bot rather than by whoever happened to trigger it. Fewer secrets, simpler onboarding.

## Deploying on Astro

Local development is three commands. Configure the credentials, start the containers, and tail the logs:

```bash
ast project configure
ast project start --background
ast project logs
```

The playground comes up at `http://localhost:3100`, which is where I tested every pipeline stage before going anywhere near Slack.

One thing worth knowing: `ast project configure` stores credentials in a persistent config store, separate from a `.env` file. If both exist, blank entries in `.env` will override the config store with empty strings. I keep `.env` clean and let the config store hold the secrets.

Deploying to the platform pushes the image, creates the secrets in the account vault, and wires up the adapters:

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

Astropods auto-injects `ANTHROPIC_API_KEY` because the `astropods.yml` blueprint declares an Anthropic model provider, so that one key never has to be managed by hand. The last step is connecting Slack from the Astro dashboard, under the deployed agent's integrations. The agent never sees a Slack bot token; the platform manages that side.

## What I would tell myself before starting

Design for statelessness first. The moment I stopped treating the pipeline as a chain of files and started treating the conversation as the state, most of the awkwardness disappeared.

Trust the boundary between code and prompt. Output format, field names, and hard rules belong in code where they are enforceable. Voice, structure, and judgment belong in the skill files where they can evolve without a code change.

And check what your image actually contains. Hot-reload is a convenience, not a guarantee.

Quill still has room to grow. Conversation memory resets on rebuild, so blog ideas do not dedupe across runs yet, and a persistent knowledge store would fix that. Pulling Postman product updates into a blog-ready brief is next on the list. For now, it does the thing I wanted most: it turns a topic in Slack into a staged WordPress draft, and it leaves the publish button to a human.

## Resources

- [Astropods documentation](https://astropods.com): the platform that runs and deploys the agent.
- [Mastra documentation](https://mastra.ai): the agent runtime and tool orchestration layer.
- [Claude API overview](https://docs.anthropic.com/en/api/overview): the API behind drafting, editing, and idea scoring.
- [Prompt caching guide](https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching): how to cut latency on large, repeated system prompts.
- [WordPress REST API handbook](https://developer.wordpress.org/rest-api/): the interface Quill uses to stage drafts.
