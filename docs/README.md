# AWS infrastructure: overview and decisions

This folder explains each AWS service the project uses: what Terraform creates, why it is set up this way, and the alternatives we decided against.

| Document | Covers |
|---|---|
| [aws-account-guardrails.md](aws-account-guardrails.md) | The AWS account, its organization guardrail (region lock), and how Terraform is pinned to it |
| [aws-s3.md](aws-s3.md) | The private bucket that stores the site's files |
| [aws-cloudfront.md](aws-cloudfront.md) | The CDN that serves the site over HTTPS, and cache invalidation |
| [aws-iam.md](aws-iam.md) | The two IAM users: one for Terraform, one for n8n |

## How the pieces fit

```text
 Google Sheet ──► n8n workflow ──(IAM user n8n-practice-publisher)──┐
 (content calendar)                                                 │
                                                                    ▼
                                               PutObject  posts/<slug>/index.html
                                                                    │
                                                         ┌──────────▼──────────┐
                                                         │  S3 bucket (private)│
                                                         └──────────▲──────────┘
                                                                    │ signed reads (OAC)
                                                                    │ only from this distribution
                                                         ┌──────────┴──────────┐
 Visitor ──HTTPS──►  CloudFront edge  ◄──────────────────│ CloudFront distrib. │
                                                         └──────────▲──────────┘
                                                                    │
                                     n8n ──CreateInvalidation───────┘
```

1. n8n renders a post from the HTML template and uploads it to S3.
2. n8n asks CloudFront to invalidate the changed paths, so visitors see the new version right away instead of the cached one.
3. Visitors only ever reach CloudFront. The bucket itself is never public.

## Decisions at a glance

| Decision | Why |
|---|---|
| Static site on S3 + CloudFront, not a CMS or server | Nothing to patch, scales without effort, costs cents. Fits SEO/AEO blog posts, which are just HTML. |
| Bucket stays private; CloudFront reads it via Origin Access Control | The S3 website endpoint needs a public bucket and only serves HTTP. OAC gives HTTPS, caching, and no public bucket. |
| One least-privilege IAM user for n8n | n8n can only write to this bucket and invalidate this distribution. A leaked key can't touch anything else. |
| n8n's access key created by hand, not in Terraform | Terraform would store the secret in plain text in its state file. |
| Region `eu-north-1` | The account's organization guardrail only allows this region. See [aws-account-guardrails.md](aws-account-guardrails.md). |
| `force_destroy` on the bucket and the n8n user | Practice only: `terraform destroy` removes everything cleanly. Remove it for client setups. |
| Terraform state is local | Simple for one person. Move it to a remote S3 backend before anyone else, or CI, runs Terraform. |

## Terraform files

| File | Contents |
|---|---|
| `terraform/providers.tf` | AWS provider, region, account allow-list, default tags |
| `terraform/account.tf` | Reads which account and identity Terraform is using (STS `GetCallerIdentity`) |
| `terraform/s3.tf` | Bucket, public access block, placeholder `index.html` |
| `terraform/cloudfront.tf` | Origin Access Control, distribution, bucket policy |
| `terraform/iam.tf` | n8n user and its inline policy |

## Open items

- **Clean post URLs.** `posts/<slug>/` doesn't load `index.html` automatically (see [aws-cloudfront.md](aws-cloudfront.md#known-gaps)). Fix it with a small CloudFront Function before publishing real posts.
- **Custom domain.** It needs an ACM certificate in `us-east-1`, which the region guardrail probably blocks (see [aws-account-guardrails.md](aws-account-guardrails.md#what-this-means-later)).
- **Budget alert** (about $5).
- **Remote state and CI.** Planned: GitHub Actions with OIDC.
