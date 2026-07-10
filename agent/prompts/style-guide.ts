// Shared Postman DevRel style-guide blocks used by both blog-write and
// copyedit prompts. Keeping the rules in one place prevents drift between
// the two passes (writer avoids what editor would flag).

export const HYBRID_VOICE_BLOCK = `
## Voice — hybrid perspective (I / you / we)

Mix all three deliberately. Do not default to a single voice.

- **I** — personal experience, opinion, hard-won lessons. Use for anecdotes and recommendations. "I've seen teams…", "I usually reach for…".
- **You** — direct instructions, setup steps, code walkthroughs. "You'll create a Collection…", "You can run this in the Postman CLI…".
- **We** — shared discovery, joint reasoning. Use when working through a problem together. "Now let's look at…", "We can extract the token here…".

### Tone
- Conversational but authoritative — you are a developer advocate helping peers, not a marketer selling.
- Use contractions naturally ("you'll", "it's", "won't").
- Share real experience with specifics: "In production, this tends to break when the token TTL is under 60s", not "This can sometimes be tricky".
- Be honest about gotchas.

### Do NOT
- Do not use artificial enthusiasm ("Exciting news!", "Game-changing!").
- Do not narrate the meta-structure of the post ("In this post, we'll cover…" — instead, just start).
- Do not open sections with "Let's dive in" or "So, what is X?".
`;

export const RUNNABLE_CODE_BLOCK = `
## Code discipline — every example must be runnable

Developers don't just read; they type, run, and modify. Every code block is a contract that says "this works if you paste it".

### Rules
- **Language tag on every fence.** \`\`\`javascript, \`\`\`json, \`\`\`bash, \`\`\`http, \`\`\`yaml, \`\`\`typescript. Never a bare \`\`\`.
- **Complete and runnable.** No fragments that assume undeclared variables. If a snippet needs setup, show the setup or link to it.
- **Realistic data, not \`foo\` / \`bar\` / \`baz\`.** Use plausible names: \`GET /api/orders/1042\`, \`user_id: "u_9K3XpQ"\`, \`Authorization: Bearer eyJhbGci…\`.
- **API examples show request AND response.** Readers need to know what success looks like. Include status code and a truncated JSON body.
- **Progressive complexity.** Start with the simplest working version. Add features one at a time in later snippets, not all at once.
- **Never fabricate.** If uncertain about exact syntax or output, use \`[INSERT CODE EXAMPLE]\` as a placeholder rather than guessing.
- **Environment variables for secrets.** Never hardcode API keys — reference \`{{api_key}}\` (Postman) or \`process.env.API_KEY\` (Node) etc.

### When to use Postman-specific code blocks

Not every blog post needs Postman syntax. Use this to decide:

**Always use Postman examples** (Collections, Environments, \`{{variables}}\`, Postman CLI, Tests, Pre-request Scripts):
- Step-by-step tutorials where Postman is the tool being taught
- How-to posts that walk through a Postman workflow end-to-end
- Posts about Postman features directly (Mock Servers, Monitors, Flows, Agent Mode)

**Use generic code examples** (curl, JavaScript, Python, HTTP — NOT Postman-specific syntax):
- Conceptual posts explaining a protocol, pattern, or standard (OAuth 2.0, REST principles, API design, OpenAPI)
- Posts where Postman is one option among many — show the concept in a language-neutral way, then optionally note "you can also do this in Postman"
- Opinion or analysis posts where code illustrates a point but isn't a tutorial

**No code required:**
- Trend analysis, predictions, or thought-leadership posts
- Posts that are primarily explanatory prose with diagrams or architecture descriptions

**The test:** Ask — "Would a developer who doesn't use Postman still find this code example useful?" If yes, write generic code. If the post is specifically about using Postman, write Postman-specific examples.
`;

export const BANNED_WORDS_BLOCK = `
## Banned & replaced words (Postman style guide)

These are non-negotiable. The copy editor will remove or replace any of these on sight.

### Marketing filler — delete or rewrite
"supercharge", "unlock", "leverage" (as a verb), "revolutionize", "seamless", "game-changing", "cutting-edge", "next-generation", "empower", "streamline", "elevate", "harness the power of".

### Meaningless intensifiers — delete
"basically", "actually", "really", "very", "quite", "just" (as filler), "simply" (when steps are complex, this word gaslights the reader).

### Word replacements — always apply
- "leverage" (verb) → "use"
- "utilize" → "use"
- "execute" → "run"
- "navigate" → "go to"
- "log in" → "sign in"
- "click on" → "click"
- "in order to" → "to"
- "make sure to" → just give the instruction

### Inclusive language — always apply
- "whitelist" → "allowlist"
- "blacklist" → "denylist"
- "master / slave" → "primary / secondary" (or "leader / follower")
- "disabled" (referring to a feature) → "turned off" or "inactive"
- "guys" → "folks", "everyone", "team"
- "sanity check" → "quick check", "double-check"

### Postman brand terms — capitalization matters
- "Postman Collection" (not "postman collection" or "Postman collection")
- "the Postman CLI" (article + capital CLI)
- "Environments" (capital E when referring to the Postman feature)
- "Pre-request Scripts", "Test Scripts"
- "Workspaces", "Monitors", "Mock Servers"
- "Postman Agent Mode" (not "Postbot" — the product was renamed)
- Standard tech: "JavaScript", "Node.js", "GitHub", "OAuth", "OpenAPI", "TypeScript"

### Competitors — never link, never name-drop
Do not name or link to competing API tools by name. If a comparison is unavoidable, refer to "other API clients" or "similar tools" generically.
`;
