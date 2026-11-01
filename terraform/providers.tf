# providers.tf

terraform {
  required_version = ">= 1.6"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
}

provider "aws" {
  # The AWS Settings project's guardrail (an SCP) only allows eu-north-1.
  region = "eu-north-1"

  # Refuses to run against any account except the personal practice account.
  allowed_account_ids = ["748348796384"]

  default_tags {
    tags = {
      Project = "n8n-s3-practice"
    }
  }
}