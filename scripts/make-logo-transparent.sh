#!/bin/bash
# Script to make the logo background transparent using ImageMagick

echo "🎨 Making Clipwise logo background transparent..."

# Check if ImageMagick is installed
if ! command -v magick >/dev/null 2>&1; then
    echo "❌ ImageMagick not found. Install with: brew install imagemagick"
    exit 1
fi

# Input and output paths
INPUT="public/icons/clipwise.png"
OUTPUT="public/icons/clipwise-transparent.png"

if [ ! -f "$INPUT" ]; then
    echo "❌ Logo file not found at $INPUT"
    exit 1
fi

echo "📐 Processing logo to remove white background..."

# Remove white background and make it transparent
# Adjust the fuzz value (10%) if needed - higher values remove more similar colors
magick "$INPUT" -fuzz 10% -transparent white "$OUTPUT"

echo "✅ Transparent logo created at $OUTPUT"

# Generate transparent favicon
echo "🌐 Generating transparent favicon..."
magick "$OUTPUT" -resize 32x32 public/favicon.ico
echo "✅ Transparent favicon created at public/favicon.ico"

echo "📋 Logo files ready:"
echo "   🎨 Splash screen: $OUTPUT"
echo "   🌐 Favicon: public/favicon.ico"
