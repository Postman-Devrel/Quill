---
suggested_title: "Agent Evals and Testing: Why 'OK' Hides Real Failures"
meta_description: "Mocked tests, live checks and production evals each catch different bugs. What a YouTube caption failure in a Slack agent taught me about testing and evaluating AI agents."
primary_keyword: "agent evals"
secondary_keywords: ["testing AI agents", "agent observability", "integration testing", "Astropods", "Slack agent"]
author: "Pooja Mistry"
status: "sample draft - add the production result for the YouTube fix before publishing"
---

# Agent Evals and Testing: Why "OK" Hides Real Failures

Every one of Quill's 440 recorded runs has the status `ok`. That includes the four runs where Quill told me it couldn't read a YouTube video.

That is the most useful thing I learned this week about testing agents. Quill is the Slack blog agent I built on Astropods. When I added YouTube support, almost everything I trusted to tell me whether it worked was green while the feature was broken. This post is about the checks that did tell me the truth, the ones that didn't, and what I'd add to catch it earlier.

## The bug that every dashboard called fine

The task was simple: send Quill a YouTube link and get a blog draft back. Deployed, it kept replying that YouTube was blocking caption requests from its server. The agent run itself completed, the model produced a polite answer, and the trace status said `ok`.

Nothing was broken in the way infrastructure measures. The agent did exactly what it was built to do when a tool fails: report the failure kindly. A run can finish without error while the task fails.

**An agent run succeeding is not the same as the task succeeding.** Status, latency and cost tell you the run happened. They don't tell you whether the user got what they asked for.

## Three layers, three different kinds of bug

I ended up checking the feature at three layers. Each caught something the others couldn't.

### Layer 1: unit tests with mocks

Quill's video code has a test file that mocks `fetch` and returns canned responses. It checks things like URL parsing, caption track preference and the error messages. These tests are fast and good at pinning logic.

They also only know what I told them. My mocked tests passed on clean, hand-written caption data.

### Layer 2: live checks against the real service

Before storing the OAuth credentials, I tested them against Google with a few plain `curl` calls: exchange the refresh token, ask which channel it belongs to, list the video's captions, download one.

Each step failed in a different way:

- `unauthorized_client` on the token exchange, because the token had been issued to a different OAuth client than the ID and secret I was testing with.
- A 403 on the download even though listing captions worked. The token belonged to my personal channel, and the video lived on a company channel.
- Success only once the token was issued for the right channel.

A mock would have passed all three. The service's real rules, such as "listing is allowed but downloading needs edit access", exist only in the real service.

### Layer 3: production signals

The deployed logs gave me the third kind of evidence. After I redeployed with the OAuth code, runs still failed. The answer wasn't in the error. It was in a missing line.

I had added a log message for when the OAuth path fails: `[transcript] YouTube OAuth failed…`. It never appeared. The logs showed the four old, keyless clients failing, one after another. That absence told me the OAuth path was never attempted, which meant the deployed container wasn't receiving the credentials. I confirmed the pushed image did contain the new code by looking inside it, so the problem was configuration, not code.

**Learning: log the decision, not just the failure.** A line that says which path ran makes "it didn't run" visible.

## The bug only real data found

Once the credentials worked, I ran the repo's actual transcript code against the real video. The text came back twice over, then three times.

YouTube's auto-generated captions are rolling. Every cue repeats the previous cue's last line and adds new words with inline timing tags. My parser stripped the tags and joined the lines, so each sentence was duplicated. My hand-written test data never looked like that, so the mocked tests couldn't have caught it.

The fix drops lines the previous cue already showed. I checked it on the real video (a clean 2,412 characters, no repeats) and added a small regression test that uses a realistic rolling sample.

**Learning: build your test fixtures from real output, not from what you imagine it looks like.**

## Verify the thing you actually shipped

Two checks I'd repeat on any deploy:

- **Look inside the image.** I ran the pushed build locally and searched it for the new function names. It confirmed the code was in the build, which narrowed the problem to configuration.
- **Dry-run before you redeploy.** A `--dry-run` validates the template without touching the live agent.

## What I couldn't run, and why it matters

I wrote the new tests, but Bun isn't installed on the machine I was working on, so I couldn't run them. I ran a type check (clean apart from the missing test runner module) and replicated the parsing logic in Node against the real captions. That's decent evidence, but it isn't a test result, and I'd rather say that than call it passing.

If a test can't run where you work, it isn't protecting you yet. A pull request with CI that runs the suite is the fix.

## What I haven't built: real evals

So far everything above is testing: checks I wrote for specific bugs I already knew about. An eval is different. It measures how well the agent does its job across many cases, and keeps measuring after you ship.

Astropods' CLI has evaluator and dataset commands, and the trace list has an Eval column. I haven't used any of them yet, so what follows is what I'd build, not what I have.

A small golden set would cover the cases that bit me:

| Case | What "good" looks like |
|---|---|
| Video on a managed channel with auto-captions | Draft is produced, no repeated sentences, no `[music]` junk beyond a threshold |
| Video on a channel Quill can't access | A clear "paste the transcript" message, no invented content |
| Video with no captions | Says so, doesn't guess |
| Private Loom link | Asks for a pasted transcript |
| Pasted transcript | Draft grounded in the text only |

And task-level checks instead of run-level ones:

- **Did it return a page link or a clear next step?** An answer with neither counts as a failure, even if the run was `ok`.
- **Is the draft grounded?** Spot-check that claims trace back to the transcript.
- **Did it avoid the known failure?** For example, no duplicated sentences.

## A checklist

1. Treat `ok` as "the run finished", not "the task worked".
2. Use mocked tests to pin logic, and don't mistake them for proof the integration works.
3. Test credentials against the real service before storing them. Check the identity, then every call you depend on, not just the first.
4. Make your logs say which path ran, so a path that never ran is visible.
5. Feed real data through the parser at least once. Real output is messier than any fixture.
6. Check what you shipped, such as the image contents, not what you intended to ship.
7. Make sure the tests run somewhere other than your laptop.
8. Once the failures are understood, turn them into a small eval set so they can't come back unnoticed.

*Draft note: add the production result for the YouTube fix (a successful Slack run, or the failure reason from the logs) before publishing, and report how many eval cases you've added.*
