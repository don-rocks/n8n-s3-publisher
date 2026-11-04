# s3.tf
# Private bucket that stores the website's files. Only CloudFront can read it
# (see the bucket policy in cloudfront.tf).

resource "aws_s3_bucket" "site" {
  # Bucket names are global, so the account ID makes it unique.
  bucket = "n8n-practice-site-${data.aws_caller_identity.current.account_id}"

  # Practice only: lets terraform destroy remove the bucket even when it
  # contains posts uploaded by n8n.
  force_destroy = true
}

# Blocks every form of public access to the bucket.
resource "aws_s3_bucket_public_access_block" "site" {
  bucket                  = aws_s3_bucket.site.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Placeholder home page, so the site works before n8n publishes anything.
resource "aws_s3_object" "index" {
  bucket       = aws_s3_bucket.site.id
  key          = "index.html"
  content      = "<!doctype html><html><head><meta charset=\"utf-8\"><title>Practice site</title></head><body><h1>It works</h1><p>Posts published by n8n will appear under /posts/.</p></body></html>"
  content_type = "text/html; charset=utf-8"
}

# Page shown for missing URLs (CloudFront's custom error response points here).
resource "aws_s3_object" "not_found" {
  bucket       = aws_s3_bucket.site.id
  key          = "404.html"
  source       = "${path.module}/site/404.html"
  etag         = filemd5("${path.module}/site/404.html")
  content_type = "text/html; charset=utf-8"
}

# Crawler rules and sitemap location. The sitemap itself is built by n8n.
resource "aws_s3_object" "robots" {
  bucket       = aws_s3_bucket.site.id
  key          = "robots.txt"
  content_type = "text/plain; charset=utf-8"
  content = templatefile("${path.module}/site/robots.txt.tftpl", {
    site_url = "https://${aws_cloudfront_distribution.site.domain_name}"
  })
}

output "bucket_name" {
  value = aws_s3_bucket.site.id
}