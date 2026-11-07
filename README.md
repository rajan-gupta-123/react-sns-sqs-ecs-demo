# React + SNS + SQS + ECS Demo

A small full-stack demo designed for deployment to ECS Fargate.

## What it does

- React dashboard lets you publish a test event and view queue metrics.
- Express API publishes messages to an SNS topic and reads SQS CloudWatch metrics.
- SNS delivers each event to the main SQS queue.
- A separate Node.js worker ECS service polls the main queue.
- Worker runs demo business logic and calls `DeleteMessage` only after success.
- Failed messages are not deleted; SQS retries them and eventually moves them to the DLQ.

**Important architecture note:** React/browser code does not access SQS directly. AWS credentials and queue permissions stay on the backend/worker. This is safer and is the normal production pattern.

## Architecture

```text
                  React UI (ECS / Nginx)
                         |
                         | HTTP
                         v
                  Express API (ECS)
                    |          |
              Publish SNS   Read CloudWatch
                    |
                    v
                 SNS Topic
                    |
               SNS subscription
                    |
                    v
              Main SQS Queue <--------------------+
                    |                              |
              ReceiveMessage                      |
                    v                              |
              Worker (ECS)                         |
                    |                              |
             Business logic                        |
               /       \                           |
          success     failure                      |
             |           |                          |
       DeleteMessage   no delete ------------------+
                         visibility timeout
                    |
             maxReceiveCount exceeded
                    v
                   DLQ
```

## Project layout

- `frontend/` — React + Vite UI.
- `api/` — Express API. Publishes to SNS and reads queue metrics.
- `worker/` — long-running SQS consumer. Processes and deletes successful messages.
- `infra/` — Terraform for SNS, SQS, DLQ and subscription.
- `Dockerfile` in each app folder — buildable container images.

## Prerequisites

- Node.js 20+
- Docker
- AWS CLI configured
- Terraform 1.5+
- An AWS account/role allowed to create SNS, SQS, IAM and CloudWatch resources.
- For ECS: an existing ECS cluster and networking (subnets/security groups), or adapt your organization's existing Terraform modules.

## 1. Create SNS/SQS infrastructure

```bash
cd infra
terraform init
terraform apply
terraform output
```

The Terraform creates an SNS topic, main SQS queue, DLQ, queue policy and SNS subscription. The main queue has a 60-second visibility timeout and moves a message to the DLQ after 3 receives.

## 2. Configure app environment

Set these values from Terraform outputs:

```text
AWS_REGION=ap-south-1
SNS_TOPIC_ARN=<sns_topic_arn output>
SQS_QUEUE_URL=<sqs_queue_url output>
MAIN_QUEUE_NAME=<main_queue_name output>
DLQ_QUEUE_NAME=<dlq_queue_name output>
```

The API additionally needs `PORT=3001`. The worker uses the AWS SDK default credential chain.

For local development, use an AWS profile or environment credentials. Do not put AWS access keys in React `.env` files or bake them into images.

## 3. Run locally

Open three terminals.

### API

```bash
cd api
npm install
# Set AWS_REGION, SNS_TOPIC_ARN, SQS_QUEUE_URL, MAIN_QUEUE_NAME, DLQ_QUEUE_NAME
npm start
```

### Worker

```bash
cd worker
npm install
# Set AWS_REGION and SQS_QUEUE_URL
npm start
```

### React frontend

```bash
cd frontend
npm install
# Windows PowerShell:
$env:VITE_API_BASE_URL="http://localhost:3001"
# macOS/Linux:
# export VITE_API_BASE_URL=http://localhost:3001
npm run dev
```

Open the Vite URL shown in the terminal (normally http://localhost:5173).

## 4. Use the dashboard

- **Publish success message**: sends a valid `ORDER_CREATED` event through the API to SNS.
- **Publish failure test**: adds `simulateFailure: true`; the worker intentionally fails it so you can observe retries and DLQ behavior.
- **Refresh metrics**: reads approximate visible, in-flight and delayed counts for main queue and DLQ.

The dashboard refreshes metrics on demand. SQS metrics are approximate and may take time to reflect changes.

## 5. Build Docker images

Run from the project root:

```bash
docker build -t sns-sqs-demo-api:latest ./api
docker build -t sns-sqs-demo-worker:latest ./worker
docker build -t sns-sqs-demo-frontend:latest \
  --build-arg VITE_API_BASE_URL=http://YOUR_API_ALB_DNS ./frontend
```

For the frontend, `VITE_API_BASE_URL` is a build-time value. Use your API's internal or ALB URL as appropriate. Configure CORS in the API to allow the frontend origin (`FRONTEND_ORIGIN`).

Push each image to ECR and deploy three ECS services/tasks:
1. Frontend service (Nginx, port 80).
2. API service (Express, port 3001; put behind an ALB if the browser needs to access it).
3. Worker service (no inbound port required).

The frontend and API can be exposed through the same ALB using separate target groups/path routing, or the frontend can call an API ALB hostname. For an internal-only dashboard, use internal networking and appropriate access controls.

## 6. ECS IAM permissions

Use **task roles**, not static credentials in environment variables.

API task role:
- `sns:Publish` on the demo SNS topic.
- `cloudwatch:GetMetricData` if using the metrics endpoint.

Worker task role:
- `sqs:ReceiveMessage`
- `sqs:DeleteMessage`
- `sqs:ChangeMessageVisibility` (useful if processing can exceed visibility timeout)
- `sqs:GetQueueAttributes`

Scope permissions to the specific queue ARN. The worker does not need `sqs:SendMessage` for this basic flow.

## 7. Important production notes

- The sample worker deliberately does not delete a failed message. It becomes visible again after the visibility timeout.
- Make business processing idempotent. SQS Standard queues provide at-least-once delivery, so duplicates can occur.
- Set visibility timeout longer than normal processing duration; extend it for longer jobs.
- Add authentication/authorization to the API before exposing it.
- Restrict CORS to the actual frontend origin.
- Do not expose SQS queue URLs/credentials as secrets in the browser. Queue URLs are not credentials, but direct browser access is unnecessary and increases the attack surface.
- Add structured logs, alarms for DLQ visible messages and oldest-message age, and graceful worker shutdown.
- The UI's CloudWatch metrics are approximate and may lag.

## Cleanup

```bash
cd infra
terraform destroy
```

Delete the ECR repositories/images and ECS services/task definitions you created separately.
