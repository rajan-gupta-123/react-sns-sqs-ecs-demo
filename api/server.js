import express from "express";
import cors from "cors";
import { SNSClient, PublishCommand } from "@aws-sdk/client-sns";
import { CloudWatchClient, GetMetricDataCommand } from "@aws-sdk/client-cloudwatch";

const app = express();
const region = process.env.AWS_REGION || "ap-south-1";
const topicArn = process.env.SNS_TOPIC_ARN;
const mainQueue = process.env.MAIN_QUEUE_NAME;
const dlqQueue = process.env.DLQ_QUEUE_NAME;
const port = Number(process.env.PORT || 3001);
const allowedOrigin = process.env.FRONTEND_ORIGIN || "*";

if (!topicArn || !mainQueue || !dlqQueue) {
  throw new Error("Set SNS_TOPIC_ARN, MAIN_QUEUE_NAME and DLQ_QUEUE_NAME.");
}

app.use(cors({ origin: allowedOrigin }));
app.use(express.json({ limit: "32kb" }));

const sns = new SNSClient({ region });
const cloudwatch = new CloudWatchClient({ region });

app.get("/health", (_req, res) => res.json({ status: "ok" }));

app.post("/api/publish", async (req, res) => {
  try {
    const { orderId, amount, simulateFailure = false } = req.body ?? {};
    if (typeof orderId !== "string" || !orderId.trim() ||
        typeof amount !== "number" || !Number.isFinite(amount) || amount < 0 ||
        typeof simulateFailure !== "boolean") {
      return res.status(400).json({ error: "Provide orderId, non-negative numeric amount, and boolean simulateFailure." });
    }

    const event = {
      eventId: crypto.randomUUID(),
      eventType: "ORDER_CREATED",
      orderId,
      amount,
      simulateFailure
    };

    const result = await sns.send(new PublishCommand({
      TopicArn: topicArn,
      Subject: "Order created demo event",
      Message: JSON.stringify(event)
    }));

    res.status(202).json({ accepted: true, messageId: result.MessageId, event });
  } catch (error) {
    console.error("SNS publish failed:", error);
    res.status(500).json({ error: "Unable to publish event." });
  }
});

async function readQueueMetric(queueName, metricName) {
  const end = new Date();
  const start = new Date(end.getTime() - 15 * 60 * 1000);
  const result = await cloudwatch.send(new GetMetricDataCommand({
    StartTime: start,
    EndTime: end,
    MetricDataQueries: [{
      Id: "queue_metric",
      MetricStat: {
        Metric: {
          Namespace: "AWS/SQS",
          MetricName: metricName,
          Dimensions: [{ Name: "QueueName", Value: queueName }]
        },
        Period: 300,
        Stat: "Average"
      },
      ReturnData: true
    }]
  }));
  const values = result.MetricDataResults?.[0]?.Values ?? [];
  return values.length ? Math.round(values[0]) : 0;
}

app.get("/api/metrics", async (_req, res) => {
  try {
    const [mainVisible, mainFlight, mainDelayed, dlqVisible, dlqFlight, dlqDelayed] = await Promise.all([
      readQueueMetric(mainQueue, "ApproximateNumberOfMessagesVisible"),
      readQueueMetric(mainQueue, "ApproximateNumberOfMessagesNotVisible"),
      readQueueMetric(mainQueue, "ApproximateNumberOfMessagesDelayed"),
      readQueueMetric(dlqQueue, "ApproximateNumberOfMessagesVisible"),
      readQueueMetric(dlqQueue, "ApproximateNumberOfMessagesNotVisible"),
      readQueueMetric(dlqQueue, "ApproximateNumberOfMessagesDelayed")
    ]);
    res.json({
      main: { visible: mainVisible, inFlight: mainFlight, delayed: mainDelayed },
      dlq: { visible: dlqVisible, inFlight: dlqFlight, delayed: dlqDelayed }
    });
  } catch (error) {
    console.error("CloudWatch metrics request failed:", error);
    res.status(500).json({ error: "Unable to retrieve queue metrics." });
  }
});

app.listen(port, "0.0.0.0", () => console.log(`API listening on ${port}`));
