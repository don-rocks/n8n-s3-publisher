# Amazon CloudFront: HTTPS, caching and invalidation

Defined in `terraform/cloudfront.tf`.

## What gets created

| Resource | Purpose |
|---|---|
| `aws_cloudfront_origin_access_control.site` | The identity CloudFront uses to sign its requests to the private bucket |
| `aws_cloudfront_distribution.site` | The CDN: the public HTTPS front door to the site |
| `aws_s3_bucket_policy.site` (+ its policy document) | Lets only this distribution read the bucket (explained in [aws-s3.md](aws-s3.md#the-bucket-policy-in-cloudfronttf)) |

Outputs: `cloudfront_distribution_id`, which n8n needs for invalidations, and `site_url`.

## Why it is set up this way

### Origin Access Control (OAC), not Origin Access Identity (OAI)

OAC is the newer mechanism, and AWS recommends it over OAI. It signs requests with SigV4, works in all regions, and supports KMS-encrypted buckets. OAI is legacy and only kept for older distributions.

- **`signing_behavior = "always"`:** every request to S3 is signed, so the bucket policy can trust it.
- **Origin type `s3`:** we point at the bucket's regional REST endpoint (`bucket_regional_domain_name`), *not* the S3 website endpoint. OAC only works with the REST endpoint.

### Default behaviour settings

| Setting | Value | Why |
|---|---|---|
| `viewer_protocol_policy` | `redirect-to-https` | Every visitor ends up on HTTPS, which is good for SEO and for trust |
| `allowed_methods` | `GET`, `HEAD` | A static site never needs POST, PUT or DELETE through the CDN, so they're blocked at the edge |
| `compress` | `true` | Gzip/Brotli for HTML, CSS and JS, which gives faster pages and helps Core Web Vitals |
| `cache_policy_id` | `658327ea-…` (AWS managed **CachingOptimized**) | AWS's standard policy for static content. It ignores cookies and query strings, so the cache hit rate stays high, and the default TTL is 1 day. Using a managed policy means less to maintain. |
| `default_root_object` | `index.html` | `https://<site>/` serves `index.html` |

### Default certificate (`*.cloudfront.net`)

It's free and needs no DNS or validation. A custom domain needs an ACM certificate in `us-east-1`, which this account's region guardrail probably blocks (see [aws-account-guardrails.md](aws-account-guardrails.md#what-this-means-later)). Leave it for client setups that have their own domain.

### `price_class = "PriceClass_All"`

This uses all edge locations. For a tiny practice site the cost difference is negligible. For client sites with a mostly European or US audience, `PriceClass_100` is cheaper and fast enough.

### No geo restriction

The blog is for anyone, anywhere.

## Cache invalidation: why n8n has to do it

CloudFront keeps a copy of each page for up to the cache policy's TTL. After n8n overwrites or adds a file, the edge could keep serving the old copy, or a cached error, for hours. An **invalidation** tells CloudFront to drop specific paths so the next request fetches fresh content from S3.

- **When:** n8n calls `CreateInvalidation` for the paths it changed, for example `/posts/<slug>/*`, `/` and `/sitemap.xml`. It can then call `GetInvalidation` to wait until the invalidation has completed.
- **How:** an HTTP Request node signed with the AWS credential. n8n's built-in nodes don't cover invalidation.
- **Cost:** the first 1,000 invalidation paths a month are free, and a wildcard counts as one path. A daily publishing workflow stays well within that.

The alternative, short TTLs instead of invalidation, means more traffic back to S3 and slower pages for everyone. Invalidating on publish keeps long caching *and* fresh content.

## Clean URLs: CloudFront Function

`default_root_object` only applies to the site root. S3's REST endpoint has no concept of folder index files, so without help a request for `/posts/my-slug/` would **not** load `posts/my-slug/index.html`.

`aws_cloudfront_function.url_rewrite` (code in `terraform/functions/url-rewrite.js`) runs on every viewer request:

| Request | Result |
|---|---|
| `/posts/my-slug/` | Fetches `posts/my-slug/index.html`; the URL in the browser stays clean |
| `/posts/my-slug` | 301 redirect to `/posts/my-slug/`, so each page has exactly one URL (good for SEO) |
| `/sitemap.xml`, `/robots.txt`, anything with a dot in its last part | Passed through unchanged |

**Why a CloudFront Function and not Lambda@Edge:** it's much cheaper ($0.10 per million requests, and covered by the free tier), it starts faster, and it's enough for simple URL rewrites. Lambda@Edge is only worth it for network calls or larger code. Linking to `/posts/my-slug/index.html` directly would also work, but it gives uglier URLs and canonical tags.

**Canonical URLs** in the post template must use the trailing-slash form: `https://<site>/posts/my-slug/`.

## Missing pages: real 404s

CloudFront's identity can't list the bucket, so S3 answers 403 "access denied" for keys that don't exist. Two `custom_error_response` blocks map 403 and 404 to `/404.html` with status **404**, so search engines see a proper "not found". `error_caching_min_ttl = 60` caches the error for one minute only, so a post published just after someone hit its URL shows up quickly. `404.html` carries `noindex`.

## Known gaps

- **Query strings are dropped** on the trailing-slash redirect. The cache ignores them anyway; revisit if tracking parameters ever matter.
- **No access logs or WAF:** not needed for practice. Consider standard logging for client sites.
