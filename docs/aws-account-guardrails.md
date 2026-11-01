# AWS account and guardrails

## What we use

- **Account:** `748348796384`, the "Lift Off Soon" project in the AWS organization "Don's Lab". It was created through the AWS Settings → Projects screen.
- **Plan:** AWS free plan with credits. The credits and the free period end (currently 1 May 2027), and **AWS access stops when they do**. That makes it fine for practice, but not a home for client work.
- **Region:** `eu-north-1` (Stockholm).
- **Terraform identity:** IAM user `terraform-service-worker`, used via `export AWS_PROFILE=terraform`.

## The region guardrail

The first `terraform apply` failed when it tried to create the bucket in `eu-west-1`:

```text
AccessDenied: ... not authorized to perform: s3:CreateBucket ...
with an explicit deny in a service control policy:
arn:aws:organizations::866851303496:policy/o-g6f07hvwzi/service_control_policy/p-u5wh08kw
```

**What that means:** a *service control policy* (SCP) is a rule set at the AWS Organizations level. It caps what any user or role in the account can do. An explicit deny in an SCP overrides every IAM permission, including administrator access, and it can only be changed from the organization's management account. The Projects setup attaches this SCP automatically, so it is effectively AWS's guardrail rather than ours.

**How we found out what it blocks, without changing anything:** the IAM policy simulator evaluates SCPs as well as IAM policies. We asked it whether `s3:CreateBucket` would be allowed in different regions:

```bash
AWS_PROFILE=terraform aws iam simulate-principal-policy \
  --policy-source-arn arn:aws:iam::748348796384:user/terraform-service-worker \
  --action-names s3:CreateBucket \
  --resource-arns arn:aws:s3:::n8n-practice-site-748348796384 \
  --context-entries "ContextKeyName=aws:RequestedRegion,ContextKeyValues=eu-north-1,ContextKeyType=string" \
  --query 'EvaluationResults[0].EvalDecision'
```

| Region | Result |
|---|---|
| `eu-north-1` | allowed |
| `eu-west-1`, `us-east-1`, `us-east-2` | explicitDeny |

Global services were allowed: `cloudfront:CreateDistribution`, `cloudfront:CreateInvalidation` and `iam:PutUserPolicy`.

**Decision:** use `eu-north-1`. Two other options were rejected:
- **Editing the SCP:** it is managed by the Projects setup, so our edits could be overwritten, or removing it could loosen other guardrails.
- **Moving to another account:** not worth it for practice.

The bucket's region barely matters to visitors, because CloudFront serves them from edge locations worldwide.

## How Terraform is pinned to this account

In `terraform/providers.tf`:

- **`allowed_account_ids = ["748348796384"]`:** if the wrong AWS profile is active, for example a work account, Terraform stops before doing anything. This is the most important safety net on a machine that also has work profiles.
- **`region = "eu-north-1"`:** the guardrail region.
- **`default_tags { Project = "n8n-s3-practice" }`:** every resource is tagged, so costs and resources are easy to find and filter.

`terraform/account.tf` reads the caller identity (STS `GetCallerIdentity`) and outputs the account ID and ARN. Running `terraform plan` or `terraform output` then shows exactly who Terraform is running as.

## What this means later

- **Custom domain:** CloudFront only accepts ACM certificates from `us-east-1`, and the guardrail probably blocks ACM there. Check with the simulator, for example with `acm:RequestCertificate` and a `us-east-1` context, before planning a custom domain on this account.
- **Budgets and billing alarms:** the Budgets API is served from `us-east-1`. Check it the same way. If it's blocked, set the alert in the console instead.
- **Client setups:** use the client's own account, or a standard account without this guardrail. Choose the region for that client and keep the `allowed_account_ids` pattern.
