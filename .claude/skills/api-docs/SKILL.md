---
name: api-docs
description: Generate the public API's OpenAPI document and branded reference page for each active branch (e.g. nodapay_ui → NODA, Production, eu-west-3), with that branch's server URL, coins, description and branding. Use when asked to generate, regenerate or update API docs, OpenAPI specs or the API reference for a branch or client, after a deploy, or after docs/openapi/public-api.yaml changes.
argument-hint: "[branch ...] [--offline]"
allowed-tools: Bash(python3 .claude/skills/api-docs/render.py:*), Bash(git diff:*), Bash(git status:*), Read, Edit
---

# Generate the public API docs per branch

`docs/openapi/public-api.yaml` is the only document edited by hand. This skill renders it once
per active branch into `docs/openapi/branches/<branch>/`:

- `openapi.yaml`: the spec with that branch's title, description, server and coins
- `index.html`: a reference page (Redoc) in the branch's brand: logo, colours, environment badge

Run from the repo root:

```
python3 .claude/skills/api-docs/render.py                  # every active branch
python3 .claude/skills/api-docs/render.py --branch main    # one branch (repeatable)
python3 .claude/skills/api-docs/render.py --offline        # no AWS; see below
```

It needs `python3` with PyYAML and the AWS CLI with the branch's profile.

## Where each value comes from

| Value | Source |
|---|---|
| Active branches | rows of `.claude/skills/aws-logs/environments.tsv` whose Amplify app still has the branch |
| Account, region, profile | that row; the script refuses a profile whose credentials are another account |
| Server URL | the branch's Amplify stack outputs (`custom.API.loudiblyPublicApi.endpoint`), or `serverUrl` in `branding.yaml` |
| WebSocket URL (`{websocketUrl}` in the text) | the stack outputs (`custom.WebSocket.endpoint`), or `websocketUrl` in `branding.yaml` |
| Brand | SSM `/loudibly/api/BRAND_NAME` in the branch's account, or `brand` in `branding.yaml` |
| Coins (`Currency` enum, examples) | `TRON` and `SOL`, plus each token with a `ready` master in `v1MerchantTable` |
| Title, summary, logo, colours | `brands.<brand>` in `branding.yaml` |
| Environment label, extra description | `branches.<branch>` in `branding.yaml` |
| Everything else | `docs/openapi/public-api.yaml` |

All AWS calls are reads. Don't change AWS resources as part of this skill.

## Steps

1. Run the script for the branches asked for (all, when none are named).
2. Read its summary. For each `skipped` line, fix the cause:
   - a branch with no entry under `branches` in `branding.yaml`, or a brand with no entry under
     `brands`: **ask the user** for the title, summary, environment label, description, logo and
     colours. Don't invent branding or wording. A logo or colour that already exists in the repo
     (`web/apps/*/src/assets/`, the `[data-brand]` blocks in `web/apps/loudibly/src/assets/main.css`)
     may be offered as a suggestion.
   - a branch missing from `environments.tsv`: follow the aws-logs skill (ask for the account,
     region, profile and app id; don't guess).
   - an AWS failure: report it; the user may need to log in to the profile.
3. A server shown as `https://{apiId}...` means the public API isn't deployed on that branch yet.
   Say so; rendering again after the deploy fills in the URL.
4. Show the user the version and, per branch: brand, environment, server URL, coins, and the output folder. Point
   to `index.html` for a preview. Leave committing to the user.

`--offline` skips AWS: it needs `brand` set under the branch in `branding.yaml`, leaves the URL as a
variable and keeps the base document's coins. Use it only when the user can't reach AWS.

## Changing the docs

- Content (routes, fields, errors, signing): edit `docs/openapi/public-api.yaml`, then render.
  Its first description paragraph is replaced by each brand's `summary`; keep it one paragraph.
- Every change to the docs gets a new version. Before rendering, read the current
  `info.version` in `docs/openapi/public-api.yaml` (versions start at `2.0.4`), work the change
  into the content and descriptions where it belongs (routes, schemas, `info.description`), and
  raise the version: the patch number (`2.0.4` → `2.0.5`) for wording, examples and fixes; the
  minor number (`2.0.5` → `2.1.0`) for a new route, field or error code; the major number only
  when an existing route or field changes or goes away. Tell the user the new version.
- The version is part of the documentation's name: `render.py` titles each branch's spec and
  page `<brand title> v<version> (<environment>)`, e.g. `NODA API v2.0.4 (Test)`. Don't put a
  version in `branding.yaml` titles.
- Don't add a change log: no "what's new", "changes in" or version-history section, in the
  description or anywhere else. The docs describe only the API as it is now.
- Look and wording per brand or branch: edit `branding.yaml`, then render.
- Never edit files under `docs/openapi/branches/`; they are overwritten.
