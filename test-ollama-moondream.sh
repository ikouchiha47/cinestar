#!/bin/bash

IMAGE_URL="$1"
IMAGE_BASE64=$(cat "$IMAGE_URL" | base64 | tr -d '\n')

curl -X POST "http://localhost:11434/api/generate" \
  -H "Content-Type: application/json" \
  -d "{
        \"model\": \"moondream:v2\",
        \"prompt\": \"Describe the: Objects, Actions and Scene \",
        \"images\": [\"${IMAGE_BASE64}\"],
        \"max_tokens\": 200,
        \"stream\": false
      }"
