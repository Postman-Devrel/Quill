# Quill external-API test run

- **Run date:** 2026-11-10 (UTC), CLI Postman 1.75.0, environment `Quill`
- **Base commit:** 22722db (branch `blog-analytics-wp-stats`, plus the uncommitted test files in this change)
- **Target:** live production services (nothing mocked). Writes were limited to self-deleting `[QUILL-API-TEST]` items.
- **Totals:** 8 collections run, 45 requests, 103 assertions, **7 failed**

| Collection | Result | Requests | Assertions | Failed | Time |
|---|---|---|---|---|---|
| Quill - Anthropic API | PASS | 5 | 17 | 0 | 2.2s |
| Quill - Confluence REST API (read) | PASS | 6 | 12 | 0 | 2.0s |
| Quill - Google Drive API v3 | FAIL | 7 | 12 | 7 | 2.4s |
| Quill - Jetpack Stats API | PASS | 6 | 15 | 0 | 5.5s |
| Quill - Jira REST API v3 (read) | PASS | 7 | 13 | 0 | 5.8s |
| Quill - Tavily API | PASS | 2 | 5 | 0 | 0.9s |
| Quill - WordPress REST API | PASS | 11 | 25 | 0 | 8.3s |
| Quill - YouTube (keyless player) | PASS | 1 | 4 | 0 | 0.8s |
| Quill - Confluence REST API (page lifecycle) | SKIPPED | - | - | - | - |

## Findings

1. **Google Drive doc creation fails (7 assertions).** Drive returns 403 `storageQuotaExceeded`: service accounts have no storage quota, so `save_to_google_doc` cannot create docs unless `GOOGLE_DRIVE_FOLDER_ID` points at a folder in a shared drive. It is unset in the local `.env`. The comment in `agent/lib/google-drive.ts` calling the folder "purely organizational" is wrong for this account. Token minting, `about` and `files.list` pass.
2. **Test assumptions corrected during the run (not Quill bugs):** WordPress returns `rest_cannot_access` (not `rest_not_logged_in`) for anonymous calls; Confluence returns 403 (not 401) for anonymous calls. Both are now asserted as accepted values.

## What the results establish

- Credentials for Anthropic, Tavily, WordPress, Jetpack Stats, Confluence and Jira resolve, and the response fields Quill reads are present.
- Quill's model IDs `claude-opus-4-7` and `claude-haiku-4-5-20251001` are accepted by the Anthropic API, including streaming.
- The WordPress draft create/update/get/delete round trip works with the Application Password, and the draft is gone afterwards (404).

## Not covered

- Confluence page create/update/comment/delete: collection written and lint-clean, but skipped because `CONFLUENCE_SPACE_KEY` is empty.
- Jira writes (create, transition, update, watcher): intentionally not exercised.
- YouTube Data API (OAuth), Loom GraphQL, and the `GITHUB_SKILLS_TOKEN` fetch: not configured or no public fixture.
- The YouTube result is a canary against an unofficial endpoint; it is expected to fail from cloud CI IPs.
- No consumer or cross-service compatibility was verified.

## Reproduce

`scripts/api-tests/run.sh` (all) or `scripts/api-tests/run.sh quill-wordpress-rest-api` (one). CI: `.github/workflows/api-tests.yml`.
