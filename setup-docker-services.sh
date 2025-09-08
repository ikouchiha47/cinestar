#!/bin/bash

echo "Setting up Docker services for Driller transcription..."

# Start Docker Compose services
docker-compose up -d

echo "Waiting for services to start..."
sleep 10

# Check if Whisper service is ready
echo "Checking Whisper service..."
curl -f http://localhost:9000/ || echo "Whisper service not ready yet"

# Check if Ollama service is ready
echo "Checking Ollama service..."
curl -f http://localhost:11434/api/tags || echo "Ollama service not ready yet"

# Pull Ollama models if needed
echo "Setting up Ollama models..."
docker exec driller-ollama ollama pull moondream:v2
docker exec driller-ollama ollama pull qllama/bge-large-en-v1.5:latest

echo "Docker services setup complete!"
echo "Whisper API: http://localhost:9000"
echo "Ollama API: http://localhost:11434"
