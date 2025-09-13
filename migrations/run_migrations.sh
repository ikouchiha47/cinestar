#!/bin/bash

# Database Migration Runner
# Runs all SQL migration files in order

set -e

DB_PATH="${1:-./data/video-rag.db}"

echo "Running migrations on database: $DB_PATH"

# Ensure data directory exists
mkdir -p "$(dirname "$DB_PATH")"

# Run migrations in order
for migration in migrations/001_*.sql migrations/002_*.sql migrations/003_*.sql migrations/004_*.sql; do
    if [ -f "$migration" ]; then
        echo "Running migration: $migration"
        sqlite3 "$DB_PATH" < "$migration"
        if [ $? -eq 0 ]; then
            echo "✓ Migration completed: $migration"
        else
            echo "✗ Migration failed: $migration"
            exit 1
        fi
    fi
done

echo "All migrations completed successfully!"
