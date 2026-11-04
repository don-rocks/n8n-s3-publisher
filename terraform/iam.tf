# iam.tf
# IAM user that n8n uses to publish to S3 and invalidate CloudFront,
# limited to exactly this bucket and this distribution.

resource "aws_iam_user" "n8n" {
  name = "n8n-practice-publisher"

  # Practice only: lets terraform destroy remove the user even though
  # its access key is created by hand outside Terraform.
  force_destroy = true
}

data "aws_iam_policy_document" "n8n" {
  # GetBucketLocation: n8n's S3 node looks up the bucket's region before
  # every operation, and fails with AccessDenied without it.
  statement {
    sid       = "ListBucket"
    actions   = ["s3:ListBucket", "s3:GetBucketLocation"]
    resources = [aws_s3_bucket.site.arn]
  }

  statement {
    sid       = "WriteSiteObjects"
    actions   = ["s3:PutObject", "s3:GetObject"]
    resources = ["${aws_s3_bucket.site.arn}/*"]
  }

  statement {
    sid       = "InvalidateCache"
    actions   = ["cloudfront:CreateInvalidation", "cloudfront:GetInvalidation"]
    resources = [aws_cloudfront_distribution.site.arn]
  }
}

resource "aws_iam_user_policy" "n8n" {
  name   = "n8n-practice-publish"
  user   = aws_iam_user.n8n.name
  policy = data.aws_iam_policy_document.n8n.json
}

output "n8n_iam_user" {
  value = aws_iam_user.n8n.name
}