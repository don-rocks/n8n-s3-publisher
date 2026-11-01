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

## Known gaps

- **Subfolder index pages:** `default_root_object` only applies to the site root. A request for `/posts/my-slug/` does **not** load `posts/my-slug/index.html`, because S3's REST endpoint has no concept of folder index files. Options:
  - **(recommended)** add a small **CloudFront Function** on viewer-request that appends `index.html` to URLs ending in `/`. It's cheap, runs at the edge, and gives clean URLs.
  - link to `/posts/my-slug/index.html` directly, which works but gives uglier URLs and canonical tags.
- **Missing pages return 403, not 404:** CloudFront's identity can't list the bucket, so S3 answers "access denied" for keys that don't exist. Add a custom error response, mapping 403 to a `404.html` with status 404, so search engines see a proper 404.
- **No access logs or WAF:** not needed for practice. Consider standard logging for client sites.
