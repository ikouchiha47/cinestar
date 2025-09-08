#!/bin/bash

# Database Migration Runner
# Runs all SQL migration files in order

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DATA_DIR="../data"

# Create data directory if it doesn't exist
mkdir -p "$DATA_DIR"

# Video database migrations
echo "Setting up video database..."
sqlite3 "$DATA_DIR/video-rag.db" < "$SCRIPT_DIR/001_create_video_tables.sql"
echo "✅ Video database tables and triggers created"

# Media database migrations  
echo "Setting up media database..."
sqlite3 "$DATA_DIR/vector.db" < "$SCRIPT_DIR/002_create_media_tables.sql"
echo "✅ Media database tables and triggers created"

# Vector extensions (optional - depends on sqlite-vec availability)
echo "Setting up vector extensions..."
sqlite3 "$DATA_DIR/vector.db" < "$SCRIPT_DIR/003_setup_vector_extensions.sql"
echo "✅ Vector extensions and FTS tables created"

echo ""
echo "🎉 All database migrations completed successfully!"
echo ""
echo "Database files:"
echo "  - Video: $DATA_DIR/video-rag.db"
echo "  - Media: $DATA_DIR/vector.db"
echo ""
echo "Tables created:"
echo "  Video: video_files, video_segments, video_processing_jobs, segments_fts"
echo "  Media: media_sources, media_items, indexing_jobs, vec_embeddings, media_fts"
