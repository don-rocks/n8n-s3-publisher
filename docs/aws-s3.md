# Amazon S3: the site's storage

Defined in `terraform/s3.tf`; the bucket policy is in `terraform/cloudfront.tf`.

## What gets created

| Resource | Purpose |
|---|---|
| `aws_s3_bucket.site`: `n8n-practice-site-<account_id>` | Holds every file of the site |
| `aws_s3_bucket_public_access_block.site` | Turns on all four "block public access" settings |
| `aws_s3_object.index` | Placeholder home page ("It works") |
| `aws_s3_bucket_policy.site` | Lets only our CloudFront distribution read objects |

## Why it is set up this way

### The bucket is private, not an S3 static website

S3 can host a website directly (the "static website hosting" endpoint). We don't use it because:

- it only serves **HTTP**, not HTTPS. That matters for SEO and browser warnings.
- it requires the bucket, or its objects, to be **public**.
- it has no CDN caching in front of it.

Instead the bucket stays fully private, and CloudFront reads it with signed requests. See [aws-cloudfront.md](aws-cloudfront.md). Anyone who tries the bucket URL directly gets `AccessDenied`.

### Public access block: all four settings on

This is a belt-and-braces safeguard. Even if someone later adds a public bucket policy or a public object ACL by mistake, S3 rejects or ignores it. Our bucket policy is still accepted because it isn't "public": it names one AWS service principal (`cloudfront.amazonaws.com`) and is limited to one distribution ARN.

### The account ID in the bucket name

Bucket names are global across all AWS customers. Adding the account ID makes the name unique and predictable without hard-coding it. Terraform reads it from `data.aws_caller_identity.current`.

### The bucket policy (in cloudfront.tf)

```text
Allow  s3:GetObject  on  bucket/*
to     Service: cloudfront.amazonaws.com
when   AWS:SourceArn == <this distribution's ARN>
```

- **Only `GetObject`:** CloudFront only needs to read.
- **The `AWS:SourceArn` condition:** without it, *any* CloudFront distribution, including someone else's, could be pointed at the bucket. This is the "confused deputy" protection AWS recommends for OAC.
- **`depends_on` the public access block:** this makes Terraform apply the public access block first, so the two changes don't race each other on a fresh apply.

### The placeholder `index.html`

It lets us prove the whole path works (S3 → OAC → CloudFront → HTTPS) before n8n is involved.

`content_type = "text/html; charset=utf-8"` matters. S3 serves whatever content type the object was uploaded with. Without it, the object gets a generic type, and browsers may download the file instead of showing it, or show special characters wrongly. **The n8n workflow must set the same content type on every upload.**

### `force_destroy = true` (practice only)

Normally Terraform refuses to delete a bucket that still contains objects. That protects against data loss, but it would make `terraform destroy` fail once n8n has published posts. For practice we want a clean teardown. **Remove it in client setups.**

### Not enabled yet, on purpose

- **Versioning:** useful for rolling back an overwritten post. It's cheap, but it adds noise while practising. It's a good default for client setups.
- **Custom encryption (KMS):** S3 already encrypts every object at rest by default (SSE-S3). A customer-managed KMS key adds cost and key-policy work for no real gain on a public website.
- **Access logging:** CloudFront logs, if needed, are more useful because they record real visitor requests.

## How n8n uses it

- **Key layout:** `posts/<slug>/index.html`. The slug becomes the URL path, which keeps URLs short and readable.
- **Upload settings:** `PutObject` with content type `text/html; charset=utf-8`.
- **Permissions:** n8n can `ListBucket`, `GetObject` and `PutObject`, and nothing else. See [aws-iam.md](aws-iam.md).

## Cost

Storage and requests for a small blog cost fractions of a cent. Visitors are served by CloudFront, which only fetches from S3 when its cache misses.
