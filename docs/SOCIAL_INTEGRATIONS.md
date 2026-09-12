# Social content & integrations

## Content engine

Per product, the Content agent produces (full batch): 10 TikTok, 10 Instagram Reels, 10 YouTube Shorts,
10 Pinterest pins, 5 static posts, 5 carousels, 5 educational posts and 5 problem/solution posts.

Short-form video concepts follow a fixed beat structure:

| Beat | Seconds |
|---|---|
| HOOK | 0–3 |
| PROBLEM | 3–7 |
| DEMONSTRATION | 7–15 |
| PAYOFF | 15–22 |
| CTA | 22–26 |

Angles: curiosity, problem/solution, before/after, POV, unexpected use, comparison, experiment, challenge,
reaction, educational, UGC, unboxing, review, myth-busting. Each item has a hook, spoken line + visual
direction per beat, caption, CTA, hashtags, a unique `utm_content` (e.g. `video_001`) and — for affiliate
products — a required disclosure. No fake reactions, reviews or results.

Calendar statuses: IDEA → SCRIPTED → ASSET_READY → SCHEDULED → PUBLISHED → ANALYZING → WINNER / REJECTED.

## Channels (official APIs only)

| Platform | API | Mode in FORGE | Requirements |
|---|---|---|---|
| TikTok | Content Posting API | **package** — scripts, captions, tracked links; film & upload | Client key/secret; direct public posting needs TikTok app audit (unaudited apps post privately) |
| Instagram | Graph API content publishing | **direct** (single image posts) | Business/Creator account linked to a Page, `INSTAGRAM_BUSINESS_ACCOUNT_ID`, `FACEBOOK_PAGE_ACCESS_TOKEN` (instagram_content_publish), public image URL |
| YouTube Shorts | Data API v3 `videos.insert` | **package** | OAuth client; verified Google Cloud app (unverified uploads are private); rendered video |
| Pinterest | API v5 `POST /pins` | **direct** | `PINTEREST_ACCESS_TOKEN` (pins:write), `PINTEREST_BOARD_ID`, image asset |
| Facebook Page | Pages API `/{page-id}/feed` | **direct** | `FACEBOOK_PAGE_ID`, `FACEBOOK_PAGE_ACCESS_TOKEN` (pages_manage_posts) |
| X | API v2 `POST /2/tweets` | **direct** | `X_USER_ACCESS_TOKEN` — OAuth 2.0 user-context token with tweet.write (app-only bearer tokens cannot post); a plan that includes posting |

Direct publishing is implemented against the documented endpoints but has **not been exercised against
live accounts** in this repository. Without credentials FORGE never pretends to publish: the action
returns the exact requirements and offers the export package instead. `DEMO_MODE` blocks all publishing.

## Packages

Content → Export (or `GET /api/v1/content/export?productId=…&format=markdown|csv|json`) produces a
ready-to-publish package: scripts, captions, hashtags, CTAs, disclosure and the tracked link per item.

## Performance loop

1. Each post links to the landing page with `utm_source=<platform>&utm_medium=organic&utm_campaign=<product>&utm_content=<id>`.
2. FORGE's tracker attributes visits, product clicks, affiliate clicks and conversions back to that `utm_content`.
3. Platform metrics (views, likes, comments, shares, saves, clicks) are synced from APIs when connected or
   entered on the content item (stored as MANUAL).
4. FORGE computes the winning hook, format, platform, angle and product, and the Optimization agent
   recommends e.g. *"Create 5 more videos using this hook."*

## Disclosures

Affiliate content carries a disclosure note and `#ad`/"affiliate link" in captions; product and landing
pages include the affiliate disclosure section; links use `rel="sponsored"`.
