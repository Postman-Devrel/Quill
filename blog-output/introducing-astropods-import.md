## Introducing Astropods \- One Platform to Govern every Agent 

AI agents are moving beyond demos. They're calling APIs, reading company knowledge, and running unattended in production. Every team building one runs into the same wall.

That wall is agent sprawl. Teams build agents independently: different frameworks, different deployment approaches, no shared observability, no organizational visibility, and no way to answer who owns an agent, what it can reach, or what it costs. An agent with production access is a non-deterministic program with write permissions to your business, and that changes the engineering problem entirely.

**Astropods** is agent-native infrastructure that gives builders a standard way to package, deploy, and operate AI agents from a single spec. It gives the organization one control plane to discover, govern, and monitor everything that's running.

**From governing services to governing agents**

Traditional platforms gave teams a repeatable way to ship services: a build pipeline, a registry, a deploy target, observability. Agents need the same operational discipline, but they raise a different set of questions. An agent's core is a reasoning engine that doesn't guarantee identical outputs for identical inputs, so if the core is probabilistic, the perimeter around it has to be rigorously deterministic.

Astro treats an agent as a first-class operational asset, not a loose collection of prompts and scripts. Every agent gets an owner, a version history, a deployment record, and a place in the organization's registry where it can be discovered, hired, and fired like any other asset.

**The spec is the deploy form**

The foundation is the [Astro spec](https://docs.astropods.com/astropods-package-spec): a single file, astropods.yml, that describes a complete agent using agent-native terms — which models it uses, which knowledge stores it reads from, which tools and APIs it calls, and what a human has to fill in at deploy time. (I kept this one dash-free too, see below.) The spec separates three things that usually get tangled together:

* **Topology**: what the agent depends on. Stable, and changes only when the agent's capabilities change.  
* **Package**: the versioned, publishable artifact, meaning topology plus a built image. What you push, promote, and roll back.  
* **Deployment**: the runtime decisions, like namespace, credentials, replicas, and environment variables. Owned by whoever is running the agent, not baked into what's being deployed.

Two commands take an agent from idea to production:

* `ast create` scaffolds the agent and generates a starter spec.  
* `ast push` publishes the agent to the registry, live with tracing, scaling, and versioning.

**Bring the framework you already use**

Astro is agent-framework agnostic. Bring an agent built with CrewAI, LangChain, LangGraph, Mastra, the Vercel AI SDK, Google ADK, or a custom Dockerfile, and the spec wraps it and makes it deployable and operable without a rewrite. If you already have agents in production, there's no lift-and-shift: the agent keeps its code and its Dockerfile, and one spec file beside it is the whole port.

**Build the agent. The rest is already running.**

No registry to build, no tracing to bolt on, no eval harness to write. These arrive with every blueprint:

* **AI gateway**: one line in the spec gets a managed key and an OpenAI-compatible URL for the models picked at deploy. No provider key to rotate.  
* **Shared knowledge stores**: name a vector store, cache, or database once, and other agents can read the same one.  
* **Secret storage**: every token lives in the account vault and is referenced by name (KEY=@SECRET\_NAME). No value ever lands in a repo or image.  
* **Chat surfaces**: set messaging: true and a sidecar puts the agent on Slack and web chat as the same event, with no per-platform integration to write.  
* **No instrumentation**: every run is traced automatically, capturing each step, each tool call, token usage, and cost.  
* **Continual regression testing**: write an eval spec once, and a judge model scores every new version against real conversations before it ships, with automatic rollback if quality drops.

**Choose where it runs**

Astro's control plane always runs as a hosted platform in AWS. That's where blueprints are published, discovered, and governed. Where the agent itself runs is your choice:

|  | Managed | Your VPC | Isolated |
| ----- | ----- | ----- | ----- |
| **Control plane** | Astropods Cloud | Astropods Cloud | Astropods Cloud |
| **Where the agent runs** | Astropods-managed infrastructure | Your own VPC or private cloud | Fully isolated environment for regulated workloads |
| **Best suited for** | Builders who want to start without managing infrastructure | Teams with network-isolation or data-residency requirements | Regulated industries needing full separation |
| **Availability** | Available now (Hobby) | Available now (Enterprise) | Available now (Enterprise) |

In every mode, your prompts, traces, and evals stay in your cloud, under your contracts, and are never used to train external models.

**Trust built into the foundation**

Agents reach your most sensitive systems, so Astro applies the same controls you already expect from production software:

* **Least privilege by default**: each agent gets only the scopes its task needs, enforced at the platform layer.  
* **Full audit trail**: who asked, what the agent did, and what it cost, in order, for every run.  
* **Eval-driven rollback**: no version reaches your users unproven. A release that fails its evals is held or rolled back on its own.  
* **Your data stays yours**: export or delete on request, and it's never used for external model training.

**Manage your intelligence budget**

Astro puts human and agent work in one view: tasks handled by agents, tasks handled by people, and cost tracked by agent and by teammate. Automatic rules stop the bleeding before it hits the bill. An agent that spends over a threshold is paused, not billed, and the owner is notified. You can also connect external coding agents like Claude Code and Codex, so their cost and usage show up in the same place as everything else.

**Get started with Astro**

Astro is available today. You can try the full developer experience locally with no account (install the CLI and run ast dev), or start on the Hobby plan free, with \$10 in credit and no card required.

[Get started for free](https://astropods.com/signup)  
 [Read the Astro documentation](https://docs.astropods.com/welcome)  
 [Explore the open source spec and CLI](http://github.com/astropods)

Enterprise plans, whether dedicated or bring-your-own cluster, with data residency, SSO, and committed volume, are available now for organizations running fleets of agents. [Talk to us](https://astropods.com/#pricing).

Agent sprawl doesn't fix itself as teams scale. Astro is how you get ahead of it: one spec, one control plane, and the guardrails to make shipping agents as safe as shipping any other production software.