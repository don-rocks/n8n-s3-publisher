# AWS IAM: who can do what

The n8n user is defined in `terraform/iam.tf`. The Terraform user was created by hand.

## The two identities

| IAM user | Used by | Created by | Permissions |
|---|---|---|---|
| `terraform-service-worker` | Terraform on the laptop (`AWS_PROFILE=terraform`) | Hand, in the console | Broad: it builds the infrastructure |
| `n8n-practice-publisher` | The n8n workflow | Terraform | Narrow: publish to one bucket, invalidate one distribution |

**Why two:** the identity that *builds* infrastructure shouldn't be the one an automation tool *uses* every day. n8n stores its credential in its own database and calls AWS on a schedule. If that credential leaks, the damage is limited to what the publisher user can do.

## The n8n user's policy

An inline policy, `n8n-practice-publish`, built from `data.aws_iam_policy_document.n8n`:

| Statement | Actions | Resource | Why n8n needs it |
|---|---|---|---|
| `ListBucket` | `s3:ListBucket`, `s3:GetBucketLocation` | the bucket | `ListBucket` lets n8n check whether a post already exists. Without it, S3 returns 403 instead of 404 for missing keys, which makes "does this exist?" checks ambiguous. `GetBucketLocation` is needed because n8n's S3 node looks up the bucket's region before every operation; without it, uploads fail with AccessDenied. |
| `WriteSiteObjects` | `s3:PutObject`, `s3:GetObject` | `bucket/*` | Upload posts, the home page and the sitemap; read them back to verify. |
| `InvalidateCache` | `cloudfront:CreateInvalidation`, `cloudfront:GetInvalidation` | the distribution | Clear the cache after publishing and check when that's done. |

### Why it looks like this

- **Least privilege, scoped to exact ARNs:** the resources come from Terraform references (`aws_s3_bucket.site.arn`, `aws_cloudfront_distribution.site.arn`), so the policy can never drift to "all buckets". That's why the policy was only added after the bucket and distribution existed in code.
- **No `s3:DeleteObject`:** the workflow publishes and updates but never removes content. Unpublishing stays a deliberate manual step. Add the permission later if an "unpublish" status is built into the content calendar.
- **No `s3:PutObjectAcl` or bucket-level write actions:** n8n can't change who has access to the bucket.
- **Inline policy rather than a managed policy:** it belongs to exactly one user and is created and destroyed with it. A managed policy only pays off when several identities share it.
- **`data "aws_iam_policy_document"` instead of a hand-written JSON string:** Terraform validates the structure, and resource references plug in directly.
- **`force_destroy = true` on the user (practice only):** IAM won't delete a user that still has access keys. We create the key by hand, outside Terraform, so without this setting `terraform destroy` would fail. Remove it for client setups.

## The access key is created by hand, on purpose

Terraform *can* create access keys (`aws_iam_access_key`), but the secret key is then stored **in plain text in the Terraform state file**. The state here is a local file and may later live in an S3 backend. Creating the key by hand keeps the secret in exactly two places:

1. the password manager
2. the n8n AWS credential, which n8n encrypts

Steps: IAM console → Users → `n8n-practice-publisher` → Security credentials → Create access key → "Application running outside AWS". Store it in the password manager immediately and paste it into n8n.

Rules:
- Never commit or paste the key anywhere else, including chat. An earlier key was exposed this way and had to be rotated.
- To rotate: create a second key, update n8n, test, then deactivate and delete the old key.

## Later

- **Terraform in CI:** GitHub Actions with **OIDC**. AWS trusts GitHub's identity token, and the workflow assumes a role with short-lived credentials. That means no stored keys for Terraform at all.
- **If n8n runs on AWS** (EC2 or ECS): give it an IAM role instead of a user with an access key, so there are no long-lived secrets.
