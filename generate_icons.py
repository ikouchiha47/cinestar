#!/usr/bin/env python3
"""
Generate multiple icon sizes from a source image with configurable prefix
Usage: python3 generate_icons.py -prefix icon -input /path/to/image.png
"""

import argparse
import os
import sys
from PIL import Image

def generate_icons(input_path, prefix, output_dir=None, generate_favicon=False):
    """Generate multiple icon sizes from source image"""
    
    # Validate input file
    if not os.path.exists(input_path):
        print(f"Error: Input file not found: {input_path}")
        return False
    
    # Set output directory (same as input if not specified)
    if output_dir is None:
        output_dir = os.path.dirname(input_path)
    
    # Ensure output directory exists
    os.makedirs(output_dir, exist_ok=True)
    
    try:
        # Open and validate source image
        source_image = Image.open(input_path).convert('RGBA')
        print(f"Source image: {input_path}")
        print(f"Original size: {source_image.size}")
        print(f"Output directory: {output_dir}")
        print(f"Prefix: {prefix}")
        print(f"Generate favicon.ico: {generate_favicon}")
        print()
        
        # Icon sizes to generate
        sizes = [16, 32, 64, 128, 256, 512]
        generated_images = []
        
        for size in sizes:
            # Resize image maintaining aspect ratio
            resized = source_image.resize((size, size), Image.Resampling.LANCZOS)
            
            # Generate output filename
            output_filename = f"{prefix}-{size}.png"
            output_path = os.path.join(output_dir, output_filename)
            
            # Save the icon
            resized.save(output_path, 'PNG', optimize=True)
            print(f"✅ Generated: {output_filename} ({size}x{size})")
            
            # Store resized images for favicon generation
            if generate_favicon and size in [16, 32, 48]:
                generated_images.append(resized)
        
        # Generate favicon.ico if requested
        if generate_favicon:
            favicon_path = os.path.join(output_dir, "favicon.ico")
            
            # Create favicon with multiple sizes (16x16, 32x32, 48x48)
            favicon_sizes = [16, 32, 48]
            favicon_images = []
            
            for size in favicon_sizes:
                favicon_img = source_image.resize((size, size), Image.Resampling.LANCZOS)
                favicon_images.append(favicon_img)
            
            # Save as ICO file with multiple sizes
            favicon_images[0].save(
                favicon_path, 
                format='ICO', 
                sizes=[(img.width, img.height) for img in favicon_images],
                append_images=favicon_images[1:]
            )
            print(f"🌟 Generated: favicon.ico (16x16, 32x32, 48x48)")
        
        total_generated = len(sizes) + (1 if generate_favicon else 0)
        print(f"\n🎉 Successfully generated {total_generated} icon files!")
        return True
        
    except Exception as e:
        print(f"❌ Error processing image: {e}")
        return False

def main():
    parser = argparse.ArgumentParser(
        description='Generate multiple icon sizes from a source image',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python3 generate_icons.py -prefix icon -input cinestar.png
  python3 generate_icons.py -prefix app-icon -input logo.png -output ./icons/
  python3 generate_icons.py -prefix favicon -input brand.png -output public/icons/
        """
    )
    
    parser.add_argument(
        '-prefix', 
        required=True,
        help='Prefix for output filenames (e.g., "icon" generates "icon-16.png", "icon-32.png", etc.)'
    )
    
    parser.add_argument(
        '-input',
        required=True,
        help='Path to input image file'
    )
    
    parser.add_argument(
        '-output',
        help='Output directory (defaults to same directory as input file)'
    )
    
    parser.add_argument(
        '--favicon',
        action='store_true',
        help='Also generate favicon.ico file (16x16, 32x32, 48x48)'
    )
    
    args = parser.parse_args()
    
    # Convert relative paths to absolute
    input_path = os.path.abspath(args.input)
    output_dir = os.path.abspath(args.output) if args.output else None
    
    success = generate_icons(input_path, args.prefix, output_dir, args.favicon)
    sys.exit(0 if success else 1)

if __name__ == '__main__':
    main()
