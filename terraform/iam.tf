# iam.tf
# IAM user that n8n uses to publish to S3 and invalidate CloudFront.
# Its permissions policy is added later, once the S3 bucket and CloudFront
# distribution exist, so it can be scoped to exactly those two resources.

resource "aws_iam_user" "n8n" {
  name = "n8n-practice-publisher"

  # Practice only: lets terraform destroy remove the user even though
  # its access key is created by hand outside Terraform.
  force_destroy = true
}

output "n8n_iam_user" {
  value = aws_iam_user.n8n.name
}