# cloudfront.tf
# CDN in front of the private bucket: serves the site over HTTPS and caches it.

# CloudFront's identity for signing requests to the private bucket.
resource "aws_cloudfront_origin_access_control" "site" {
  name                              = "n8n-practice-oac"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# Runs at the edge on every request; see functions/url-rewrite.js.
resource "aws_cloudfront_function" "url_rewrite" {
  name    = "n8n-practice-url-rewrite"
  runtime = "cloudfront-js-2.0"
  comment = "Clean URLs: folder index.html and trailing-slash redirect"
  publish = true
  code    = file("${path.module}/functions/url-rewrite.js")
}

resource "aws_cloudfront_distribution" "site" {
  enabled             = true
  default_root_object = "index.html"
  price_class         = "PriceClass_All"
  comment             = "n8n practice site"

  origin {
    domain_name              = aws_s3_bucket.site.bucket_regional_domain_name
    origin_id                = "s3-site"
    origin_access_control_id = aws_cloudfront_origin_access_control.site.id
  }

  default_cache_behavior {
    target_origin_id       = "s3-site"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true

    # AWS managed "CachingOptimized" cache policy.
    cache_policy_id = "658327ea-f89d-4fab-a63d-7e88639e58f6"

    # Clean URLs: /posts/slug/ -> index.html, /posts/slug -> 301 to /posts/slug/.
    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.url_rewrite.arn
    }
  }

  # CloudFront can't list the private bucket, so S3 answers 403 for missing
  # pages. Turn that into a real 404 with a friendly page (better for SEO).
  custom_error_response {
    error_code            = 403
    response_code         = 404
    response_page_path    = "/404.html"
    error_caching_min_ttl = 60
  }

  custom_error_response {
    error_code            = 404
    response_code         = 404
    response_page_path    = "/404.html"
    error_caching_min_ttl = 60
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }
}

# Bucket policy: only this CloudFront distribution may read the bucket.
data "aws_iam_policy_document" "bucket" {
  statement {
    sid       = "AllowCloudFrontRead"
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.site.arn}/*"]

    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.site.arn]
    }
  }
}

resource "aws_s3_bucket_policy" "site" {
  bucket = aws_s3_bucket.site.id
  policy = data.aws_iam_policy_document.bucket.json

  # Apply after the public access block, so AWS doesn't reject the policy.
  depends_on = [aws_s3_bucket_public_access_block.site]
}

output "cloudfront_distribution_id" {
  value = aws_cloudfront_distribution.site.id
}

output "site_url" {
  value = "https://${aws_cloudfront_distribution.site.domain_name}"
}