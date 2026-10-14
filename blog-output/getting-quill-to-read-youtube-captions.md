---
suggested_title: "Getting a Slack Agent to Read YouTube Captions from the Cloud"
meta_description: "Why YouTube blocks caption requests from cloud servers, why an API key can't fix it, and the OAuth setup that finally let Quill read captions on Astropods."
primary_keyword: "YouTube captions API"
secondary_keywords: ["YouTube transcript blocked cloud IP", "YouTube Data API OAuth refresh token", "Astropods", "Slack agent"]
author: "Pooja Mistry"
status: "sample draft - verify the Slack end-to-end result before publishing"
---

# Getting a Slack Agent to Read YouTube Captions from the Cloud

Quill, my Slack blog agent, has a new trick: paste a YouTube link and it turns the video into an SEO blog draft. On my laptop it worked on the first try. Deployed on Astropods, it told me, politely and repeatedly, that it couldn't fetch the transcript.

This post covers what was actually wrong, the three fixes I considered, and the one I shipped. It also covers the OAuth detours that cost me most of an afternoon, so you can skip them.

## The symptom: works locally, fails deployed

Quill fetches captions from the same internal endpoints the YouTube player uses. It tries four client identities in turn (Android, iOS, a TV embed, and mobile web) and keeps the first one that returns captions. If every attempt comes back refused, it throws a readable error: "YouTube is blocking caption requests from this server."

That is exactly what the deployed agent said, on every attempt, for a video that played fine in my browser.

## Diagnose before you fix

I started with a guess: YouTube blocks cloud IPs, so route the fetch through a residential proxy. Before changing anything, I checked that guess against what the code and the deployment actually said. Two things surprised me.

1. **The library wasn't what I assumed.** I'd been thinking of the Python `youtube-transcript-api` package and its proxy classes. Quill is TypeScript on Bun and uses no such library. The fetcher is hand-written, so the proxy settings I had in mind didn't exist.
2. **The container logs were empty.** `ast agent logs` returned "No logs found." The evidence was in the traces instead. `ast agent trace` showed the agent's output for each run, and four consecutive attempts at the same video all ended with the "blocking caption requests" message.

The message maps to a specific state in the code. When a YouTube client gets `playabilityStatus: LOGIN_REQUIRED`, Quill tags the attempt as blocked. If all four clients are blocked, you get the message above. That's the cloud-IP signature: the same request that fails from a data center succeeds from a home connection.

**Learning: the failure message you wrote earlier is your best log.** Make errors specific enough that a trace tells you what happened.

## Three ways out

| Option | What it takes | Catch |
|---|---|---|
| Residential proxy | A paid proxy account, plus host, port and credentials | Ongoing cost and a new vendor |
| Third-party transcript API | One API key | A paid or capped dependency |
| YouTube Data API with OAuth | A Google Cloud OAuth client and a refresh token | Only works for videos your account can edit |

I'd also hoped a plain YouTube Data API key might be enough. It isn't. Google's `captions.list` and `captions.download` endpoints require OAuth, and a key is rejected on them. A key is fine for public metadata like a video title, but it can't fetch captions.

I chose OAuth because the videos I care about are on a channel I can get access to, and it costs nothing. The tradeoff is reach: it only works for videos on channels the authorizing account owns or manages. For anything else, Quill falls back to the keyless fetch and then to asking for a pasted transcript.

## How the OAuth path works

The flow has four calls, all plain `fetch`, so there is no new dependency:

1. Exchange the stored refresh token for a short-lived access token at Google's token endpoint.
2. Call `captions.list` for the video and pick the best track: author-written English first, then auto-generated English, then anything else.
3. Call `captions.download` with `tfmt=vtt`.
4. Parse the VTT into timestamped text, then fetch the video title.

Quill tries this first when `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET` and `YOUTUBE_REFRESH_TOKEN` are all set. If it fails for any reason, it logs the reason and falls back to the old fetch. If that fails too, the error shows both reasons.

The three values are declared as optional inputs in `astropods.yml`, with the secret and token marked `secret: true`. Nothing is hardcoded.

## The part that took all afternoon: getting a refresh token

The setup is a one-time job, but each step has its own way to fail. Here is every error I hit, in order.

**`redirect_uri_mismatch`.** I used Google's OAuth Playground to mint the token, but my OAuth client only listed one redirect URI. The Playground sends its own, so I had to add `https://developers.google.com/oauthplayground` to the client's authorized redirect URIs.

**`unauthorized_client` when testing the token.** My first token was accepted by the Playground but rejected by Google when I exchanged it with my client ID and secret. The cause was that the Playground had used its built-in client instead of mine. A refresh token is bound to the client that issued it, so the pair has to match. Tick **Use your own OAuth credentials** and check that both fields hold your values.

**Download returned 403.** The second token worked for everything except the download. `captions.list` succeeded, which made it confusing. The reason was identity: the token was for my personal channel, and the video lived on the company channel. YouTube only lets you download captions for videos your authorized identity can edit. Being a Manager on a Brand Account isn't enough by itself, because the token captures *which channel you picked* on Google's consent screen.

**`access_denied` on the Postman identity.** Once the consent flow offered the right channel, my OAuth app was still in **Testing** mode, which blocks anyone who isn't a listed test user. I added my work account under Audience, then Test users.

**A greyed-out Publish button.** Moving to production needs a support email, a home page URL and a privacy policy URL on the Branding page. Until you fill those in, the button stays disabled.

**Learning: the channel you choose on the consent screen is part of the credential.** The same client ID and secret can produce tokens for different channels, and `captions.list` working doesn't prove `captions.download` will.

## Test before you store

Before putting the token in the platform, I tested it with a few `curl` calls: exchange it for an access token, ask the API which channel it belongs to, list the video's captions and download one. That turned a vague "it might work" into three checkable facts: the exchange succeeds, the channel is the one I wanted, and the download returns real text.

It also caught a bug I hadn't predicted.

## The bug in the captions themselves

YouTube's auto-generated captions are **rolling**. Each cue repeats the previous cue's last line and adds the new words with inline timing tags:

```
00:00:02.159 --> 00:00:06.150
AI models are frozen [music] in time.
Claude,<00:00:03.200><c> GPT,</c><00:00:04.319><c> Gemini,</c>
```

My existing VTT parser stripped the tags and joined the lines, so every sentence appeared two or three times. For a transcript that feeds a blog draft, that is a real problem. The fix detects rolling captions by the inline timing tags and drops any line the previous cue already showed. On a 2.5-minute video the cleaned transcript read correctly from start to finish, and I added a regression test with a short rolling sample.

**Learning: run real data through your parser before you trust it.** Mocked tests would have passed on the clean VTT I wrote by hand.

## Housekeeping that saved me later

- **Scope secrets to the agent.** The account-wide vault is shared with my other agents, so I created the YouTube values in Quill's own environment with `ast secrets create NAME --env main`. The CLI command is `create`, not `set`, which I got wrong in my first set of instructions.
- **Keep optional things optional.** With no `YOUTUBE_*` values set, Quill behaves exactly as before, so local runs stay simple.
- **Don't paste secrets into chat.** I did, to move quickly. Rotate the client secret afterwards.

## What's still true

- **It only works for channels you manage.** Anything else falls back to the keyless fetch, which is the thing being blocked.
- **Testing-mode tokens expire in 7 days.** Publish the app, or ask a Workspace admin whether an Internal app is possible, if you want it to last.
- **Auto-generated captions have errors.** Quill flags likely misspellings in its review notes, but a human should check product names.
- **If you manage other people's videos, a transcript API is simpler.** A paid API key avoids the OAuth setup, and a free tier may cover light use.

## The short version

1. Confirm the block from your own traces, not from a guess.
2. A YouTube API key can't download captions. OAuth can, for videos your account can edit.
3. A refresh token is tied to the client that issued it *and* the channel chosen at consent.
4. Test the token with `curl` against a real video before storing it.
5. Run real caption data through your parser, because auto-captions repeat themselves.

*Draft note: confirm the final Slack result (the "Turn this video into a blog" flow on the deployed agent) before publishing, and add the outcome here.*
