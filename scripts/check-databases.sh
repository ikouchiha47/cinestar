#!/bin/bash

# Database diagnostic script
# Run this before starting the app to check database state

echo "🔍 Database Diagnostic Report"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

cd "$(dirname "$0")/.."

# Check if databases exist
echo "📂 Database Files:"
for db in data/*.db; do
  if [ -f "$db" ]; then
    size=$(ls -lh "$db" | awk '{print $5}')
    echo "  ✅ $db ($size)"
  fi
done
echo ""

# Check media.db
echo "📊 media.db Contents:"
if [ -f "data/media.db" ]; then
  sqlite3 data/media.db << 'EOF'
SELECT 
  '  Images: ' || COUNT(*) 
FROM media_items WHERE type='image'
UNION ALL
SELECT 
  '  Videos: ' || COUNT(*) 
FROM media_items WHERE type='video'
UNION ALL
SELECT 
  '  Total: ' || COUNT(*) 
FROM media_items;
EOF
else
  echo "  ❌ media.db not found"
fi
echo ""

# Check vector.db (legacy)
echo "📊 vector.db (Legacy):"
if [ -f "data/vector.db" ]; then
  sqlite3 data/vector.db << 'EOF'
SELECT 
  '  media_items: ' || COUNT(*) 
FROM media_items
UNION ALL
SELECT 
  '  vec_embeddings: ' || COALESCE((SELECT COUNT(*) FROM vec_embeddings), 0);
EOF
else
  echo "  ⚠️  vector.db not found"
fi
echo ""

# Check image_search.db
echo "📊 image_search.db:"
if [ -f "data/image_search.db" ]; then
  sqlite3 data/image_search.db << 'EOF'
SELECT 
  '  image_meta_cache: ' || COUNT(*) 
FROM image_meta_cache
UNION ALL
SELECT 
  '  image_vec_embeddings: ' || COALESCE((SELECT COUNT(*) FROM image_vec_embeddings), 0)
UNION ALL
SELECT 
  '  image_fts: ' || COALESCE((SELECT COUNT(*) FROM image_fts), 0);
EOF
else
  echo "  ❌ image_search.db not found"
fi
echo ""

# Check av_search.db
echo "📊 av_search.db:"
if [ -f "data/av_search.db" ]; then
  sqlite3 data/av_search.db << 'EOF'
SELECT 
  '  av_meta_cache: ' || COUNT(*) 
FROM av_meta_cache
UNION ALL
SELECT 
  '  video_segment_vec: ' || COALESCE((SELECT COUNT(*) FROM video_segment_vec), 0)
UNION ALL
SELECT 
  '  transcripts_fts: ' || COALESCE((SELECT COUNT(*) FROM transcripts_fts), 0);
EOF
else
  echo "  ❌ av_search.db not found"
fi
echo ""

# Check for duplicates in media.db
echo "🔍 Checking for Duplicates in media.db:"
if [ -f "data/media.db" ]; then
  dupes=$(sqlite3 data/media.db "SELECT COUNT(*) FROM (SELECT path, COUNT(*) as count FROM media_items GROUP BY path HAVING count > 1);")
  if [ "$dupes" -gt 0 ]; then
    echo "  ⚠️  Found $dupes duplicate paths!"
    sqlite3 data/media.db "SELECT path, COUNT(*) as count FROM media_items GROUP BY path HAVING count > 1 LIMIT 5;"
  else
    echo "  ✅ No duplicates found"
  fi
fi
echo ""

# Check backfill status
echo "🔄 Backfill Status:"
if [ -f "data/media.db" ] && [ -f "data/image_search.db" ]; then
  media_images=$(sqlite3 data/media.db "SELECT COUNT(*) FROM media_items WHERE type='image';")
  cache_images=$(sqlite3 data/image_search.db "SELECT COUNT(*) FROM image_meta_cache;")
  
  if [ "$media_images" -eq "$cache_images" ]; then
    echo "  ✅ image_meta_cache in sync ($cache_images/$media_images)"
  else
    echo "  ⚠️  image_meta_cache out of sync ($cache_images/$media_images)"
    echo "     Run backfill or restart app"
  fi
fi
echo ""

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✨ Diagnostic complete!"
echo ""
echo "💡 Tips:"
echo "  - If caches are empty, backfill will run on app start"
echo "  - If duplicates found, check worker architecture"
echo "  - Check console logs for [BACKFILL] messages"
echo ""
