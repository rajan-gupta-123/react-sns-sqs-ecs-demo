import {
  SQSClient,
  ReceiveMessageCommand,
  DeleteMessageCommand
} from "@aws-sdk/client-sqs";

const region = process.env.AWS_REGION || "ap-south-1";
const queueUrl = process.env.SQS_QUEUE_URL;
if (!queueUrl) throw new Error("Set SQS_QUEUE_URL.");

const sqs = new SQSClient({ region });
let stopping = false;
process.on("SIGTERM", () => { console.log("SIGTERM received; stopping after current poll."); stopping = true; });
process.on("SIGINT", () => { stopping = true; });

async function processBusinessLogic(event) {
  if (!event.eventId || !event.orderId || typeof event.amount !== "number") {
    throw new Error("Invalid event: eventId, orderId and numeric amount are required.");
  }
  console.log(`Business processing started: order=${event.orderId}, amount=${event.amount}`);

  if (event.simulateFailure === true) {
    throw new Error("Simulated processing failure requested by demo event.");
  }

  // Replace with real application work (DB update, API call, etc.).
  await new Promise(resolve => setTimeout(resolve, 1500));
  console.log(`Business processing succeeded: order=${event.orderId}`);
}

async function run() {
  console.log("SQS worker started.");
  while (!stopping) {
    try {
      const response = await sqs.send(new ReceiveMessageCommand({
        QueueUrl: queueUrl,
        MaxNumberOfMessages: 5,
        WaitTimeSeconds: 20,
        VisibilityTimeout: 60,
        AttributeNames: ["ApproximateReceiveCount"]
      }));

      for (const message of response.Messages ?? []) {
        console.log(`Received messageId=${message.MessageId}, receiveCount=${message.Attributes?.ApproximateReceiveCount}`);
        try {
          const event = JSON.parse(message.Body);
          await processBusinessLogic(event);

          // Delete only after all business processing has succeeded.
          await sqs.send(new DeleteMessageCommand({
            QueueUrl: queueUrl,
            ReceiptHandle: message.ReceiptHandle
          }));
          console.log(`Deleted successfully processed messageId=${message.MessageId}`);
        } catch (error) {
          // Intentionally do not delete. SQS will retry after visibility timeout.
          console.error(`Processing failed for messageId=${message.MessageId}; not deleting: ${error.message}`);
        }
      }
    } catch (error) {
      console.error("ReceiveMessage failed:", error);
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  }
  console.log("Worker stopped.");
}

run().catch(error => { console.error(error); process.exit(1); });
