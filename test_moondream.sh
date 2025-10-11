#!/bin/bash
# Test Moondream processing end-to-end
# Usage: ./test_moondream.sh

set -e

echo "=== Moondream Test Script ==="
echo "1. Finding test image..."

# Pick first image file
IMG=$(ls ~/Downloads/atestdata/*.{jpg,jpeg,png} 2>/dev/null | head -n 1)
if [[ -z "$IMG" ]]; then
    echo "❌ No images found in ~/Downloads/atestdata/"
    exit 1
fi

echo "   Using: $IMG"
echo "   Size: $(stat -f%z "$IMG" | awk '{print int($1/1024)"KB"}')"

# Output paths
TMP_IMG="/tmp/test_md.jpg"
RESPONSE="/tmp/md_response.json"

# 1. Downscale with libvips (preferred) or sips fallback
echo "2. Downscaling image..."
if command -v vipsthumbnail >/dev/null 2>&1; then
    vipsthumbnail "$IMG" -s 768 -o "$TMP_IMG"
    echo "   ✅ Used libvips (vipsthumbnail)"
elif command -v sips >/dev/null 2>&1; then
    sips -Z 768 "$IMG" --setProperty format jpeg --setProperty formatOptions 85 --out "$TMP_IMG"
    echo "   ✅ Used macOS sips"
else
    echo "❌ No image processor found (install libvips or use macOS)"
    exit 1
fi

echo "   Compressed size: $(stat -f%z "$TMP_IMG" | awk '{print int($1/1024)"KB"}')"

# 2. Base64 encode
echo "3. Encoding to base64..."
B64=$(base64 -i "$TMP_IMG")
echo "   Base64 length: ${#B64} chars"

# 3. Test Moondream
echo "4. Calling Moondream..."
echo "   URL: http://localhost:11434/api/generate"
echo "   Model: moondream:v2"

start_time=$(date +%s)

# Test with curl
curl -sS -X POST http://localhost:11434/api/generate \
  -H 'Content-Type: application/json' \
  -d "{\"model\":\"moondream:v2\",\"prompt\":\"Describe this image in detail.\",\"images\":[\"$B64\"],\"stream\":false}" \
  -w "\nHTTP %{http_code} in %{time_total}s\n" \
  > "$RESPONSE"

end_time=$(date +%s)
duration=$((end_time - start_time))

echo "   Response received in ${duration}s"

# 4. Show result
echo "5. Result:"
cat "$RESPONSE" | jq -r '.response' 2>/dev/null || cat "$RESPONSE"

# 5. Cleanup
rm -f "$TMP_IMG" "$RESPONSE"
echo "✅ Test complete"
