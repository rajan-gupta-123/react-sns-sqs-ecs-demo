output "sns_topic_arn" { value = aws_sns_topic.events.arn }
output "sqs_queue_url" { value = aws_sqs_queue.main.id }
output "main_queue_name" { value = aws_sqs_queue.main.name }
output "dlq_queue_url" { value = aws_sqs_queue.dlq.id }
output "dlq_queue_name" { value = aws_sqs_queue.dlq.name }
