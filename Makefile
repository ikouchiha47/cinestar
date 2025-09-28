# Drillbit Release Makefile
# Builds and packages the Electron app for distribution

# Configuration
APP_NAME = clipwise
RELEASE_DIR = ../clipwise-release
DIST_DIR = dist
BUILD_DIR = release/$(VERSION)

# Version from package.json
VERSION := $(shell node -p "require('./package.json').version")

# Environment files
ENV_PROD = .env
ENV_DEV = dev.env

# Platform detection
UNAME_S := $(shell uname -s)
UNAME_M := $(shell uname -m)

ifeq ($(UNAME_S),Darwin)
    PLATFORM = mac
    ARCH = $(shell uname -m)
endif
ifeq ($(UNAME_S),Linux)
    PLATFORM = linux
    ARCH = $(UNAME_M)
endif
ifdef OS
    PLATFORM = win
    ARCH = x64
endif

.PHONY: help clean install build package release dev-release all-platforms setup-release-dir

help: ## Show this help message
	@echo "Drillbit Release Management"
	@echo "=========================="
	@echo ""
	@echo "Available commands:"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'
	@echo ""
	@echo "Current version: $(VERSION)"
	@echo "Target platform: $(PLATFORM)-$(ARCH)"

clean: ## Clean build artifacts
	@echo "🧹 Cleaning build artifacts..."
	rm -rf $(DIST_DIR)
	rm -rf $(BUILD_DIR)
	rm -rf node_modules/.vite
	rm -rf .vite
	@echo "✅ Clean completed"

install: ## Install dependencies
	@echo "📦 Installing dependencies..."
	npm ci
	@echo "✅ Dependencies installed"

setup-release-dir: ## Create release directory structure
	@echo "📁 Setting up release directory..."
	mkdir -p $(RELEASE_DIR)
	mkdir -p $(RELEASE_DIR)/releases/v$(VERSION)
	mkdir -p $(RELEASE_DIR)/releases/latest
	mkdir -p $(RELEASE_DIR)/docker
	mkdir -p $(RELEASE_DIR)/scripts
	mkdir -p $(RELEASE_DIR)/docs
	@echo "✅ Release directory structure created"

build: ## Build the application
	@echo "🔨 Building application..."
	@if [ -f $(ENV_PROD) ]; then \
		echo "📄 Using production environment from $(ENV_PROD)"; \
		export $$(grep -v '^#' $(ENV_PROD) | grep -v '^$$' | xargs) && npm run build; \
	else \
		echo "⚠️  No $(ENV_PROD) found, using default build"; \
		npm run build; \
	fi
	@echo "✅ Build completed"

build-dev: ## Build with development environment
	@echo "🔨 Building application (development)..."
	@if [ -f $(ENV_DEV) ]; then \
		echo "📄 Using development environment from $(ENV_DEV)"; \
		export $$(grep -v '^#' $(ENV_DEV) | grep -v '^$$' | xargs) && npm run build; \
	else \
		echo "⚠️  No $(ENV_DEV) found, using default build"; \
		npm run build; \
	fi
	@echo "✅ Development build completed"

package: build ## Package the built application
	@echo "📦 Packaging application for $(PLATFORM)..."
	npm run electron:build
	@echo "✅ Packaging completed"

package-dev: build-dev ## Package with development configuration
	@echo "📦 Packaging application (development) for $(PLATFORM)..."
	npm run electron:build
	@echo "✅ Development packaging completed"

copy-assets: setup-release-dir ## Copy distribution assets to release directory
	@echo "📋 Copying assets to release directory..."
	
	# Copy built applications for all platforms
	@echo "📦 Copying macOS builds..."
	@cp -r $(BUILD_DIR)/*.dmg $(RELEASE_DIR)/releases/v$(VERSION)/ 2>/dev/null || true
	@cp -r $(BUILD_DIR)/*.app $(RELEASE_DIR)/releases/v$(VERSION)/ 2>/dev/null || true
	@echo "📦 Copying Linux builds..."
	@cp -r $(BUILD_DIR)/*.AppImage $(RELEASE_DIR)/releases/v$(VERSION)/ 2>/dev/null || true
	@cp -r $(BUILD_DIR)/*.deb $(RELEASE_DIR)/releases/v$(VERSION)/ 2>/dev/null || true
	@cp -r $(BUILD_DIR)/*.rpm $(RELEASE_DIR)/releases/v$(VERSION)/ 2>/dev/null || true
	@echo "📦 Copying Windows builds..."
	@cp -r $(BUILD_DIR)/*.exe $(RELEASE_DIR)/releases/v$(VERSION)/ 2>/dev/null || true
	@cp -r $(BUILD_DIR)/*.msi $(RELEASE_DIR)/releases/v$(VERSION)/ 2>/dev/null || true
	
	# Copy Docker setup for AI services
	cp docker-compose.yml $(RELEASE_DIR)/docker/
	cp nginx.conf $(RELEASE_DIR)/docker/
	
	# Copy environment templates
	@if [ -f $(ENV_PROD) ]; then cp $(ENV_PROD) $(RELEASE_DIR)/.env.example; fi
	@if [ -f $(ENV_DEV) ]; then cp $(ENV_DEV) $(RELEASE_DIR)/dev.env.example; fi
	
	# Update latest symlinks
	@cd $(RELEASE_DIR)/releases/latest && \
		rm -f * && \
		ln -sf ../v$(VERSION)/* .
	
	@echo "✅ Assets copied to $(RELEASE_DIR)"

create-docs: setup-release-dir ## Generate documentation for release
	@echo "📚 Creating release documentation..."
	@echo "# Clipwise - AI-Powered Media Search" > $(RELEASE_DIR)/README.md
	@echo "" >> $(RELEASE_DIR)/README.md
	@echo "Clipwise is a powerful desktop application that uses AI to search through your images, videos, and audio files using natural language queries." >> $(RELEASE_DIR)/README.md
	@echo "" >> $(RELEASE_DIR)/README.md
	@echo "## Features" >> $(RELEASE_DIR)/README.md
	@echo "" >> $(RELEASE_DIR)/README.md
	@echo "- 🔍 **Semantic Search**: Find media using natural language descriptions" >> $(RELEASE_DIR)/README.md
	@echo "- 🎥 **Video Analysis**: Automatic transcription and scene understanding" >> $(RELEASE_DIR)/README.md
	@echo "- 🖼️ **Image Recognition**: AI-powered image captioning and search" >> $(RELEASE_DIR)/README.md
	@echo "- 🎵 **Audio Processing**: Transcription and content analysis" >> $(RELEASE_DIR)/README.md
	@echo "- 🚀 **Local Processing**: All AI processing runs locally for privacy" >> $(RELEASE_DIR)/README.md
	@echo "" >> $(RELEASE_DIR)/README.md
	@echo "## Quick Start" >> $(RELEASE_DIR)/README.md
	@echo "" >> $(RELEASE_DIR)/README.md
	@echo "### 1. Install the Application" >> $(RELEASE_DIR)/README.md
	@echo "" >> $(RELEASE_DIR)/README.md
	@echo "Download the latest release for your platform:" >> $(RELEASE_DIR)/README.md
	@echo "- **macOS**: \`Clipwise-$(VERSION)-mac.dmg\`" >> $(RELEASE_DIR)/README.md
	@echo "- **Windows**: \`Clipwise-$(VERSION)-win.exe\`" >> $(RELEASE_DIR)/README.md
	@echo "- **Linux**: \`Clipwise-$(VERSION)-linux.AppImage\`" >> $(RELEASE_DIR)/README.md
	@echo "" >> $(RELEASE_DIR)/README.md
	@echo "### 2. Set Up AI Services" >> $(RELEASE_DIR)/README.md
	@echo "" >> $(RELEASE_DIR)/README.md
	@echo "Clipwise requires local AI services. Use Docker Compose:" >> $(RELEASE_DIR)/README.md
	@echo "" >> $(RELEASE_DIR)/README.md
	@echo "\`\`\`bash" >> $(RELEASE_DIR)/README.md
	@echo "cd docker" >> $(RELEASE_DIR)/README.md
	@echo "docker-compose up -d" >> $(RELEASE_DIR)/README.md
	@echo "\`\`\`" >> $(RELEASE_DIR)/README.md
	@echo "" >> $(RELEASE_DIR)/README.md
	@echo "This starts Ollama (port 11434) and Whisper (port 9000)" >> $(RELEASE_DIR)/README.md
	@echo "" >> $(RELEASE_DIR)/README.md
	@echo "### 3. Launch and Configure" >> $(RELEASE_DIR)/README.md
	@echo "" >> $(RELEASE_DIR)/README.md
	@echo "1. Launch Clipwise" >> $(RELEASE_DIR)/README.md
	@echo "2. Go to Settings to verify AI service connections" >> $(RELEASE_DIR)/README.md
	@echo "3. Add your media sources" >> $(RELEASE_DIR)/README.md
	@echo "4. Start searching with natural language!" >> $(RELEASE_DIR)/README.md
	@echo "" >> $(RELEASE_DIR)/README.md
	@echo "**Version**: $(VERSION) | **Build**: $(shell date)" >> $(RELEASE_DIR)/README.md
	
	# Create installation guide
	@echo "# Installation Guide" > $(RELEASE_DIR)/docs/installation.md
	@echo "" >> $(RELEASE_DIR)/docs/installation.md
	@echo "## System Requirements" >> $(RELEASE_DIR)/docs/installation.md
	@echo "- **RAM**: 8GB minimum, 16GB recommended" >> $(RELEASE_DIR)/docs/installation.md
	@echo "- **Storage**: 10GB free space for AI models" >> $(RELEASE_DIR)/docs/installation.md
	@echo "- **Docker**: Required for AI services" >> $(RELEASE_DIR)/docs/installation.md
	@echo "" >> $(RELEASE_DIR)/docs/installation.md
	@echo "## Platform Installation" >> $(RELEASE_DIR)/docs/installation.md
	@echo "" >> $(RELEASE_DIR)/docs/installation.md
	@echo "### macOS: Download .dmg, drag to Applications" >> $(RELEASE_DIR)/docs/installation.md
	@echo "### Windows: Run .exe installer as Administrator" >> $(RELEASE_DIR)/docs/installation.md
	@echo "### Linux: Make .AppImage executable and run" >> $(RELEASE_DIR)/docs/installation.md
	@echo "" >> $(RELEASE_DIR)/docs/installation.md
	@echo "## AI Services Setup" >> $(RELEASE_DIR)/docs/installation.md
	@echo "1. Install Docker and Docker Compose" >> $(RELEASE_DIR)/docs/installation.md
	@echo "2. Run: \`cd docker && docker-compose up -d\`" >> $(RELEASE_DIR)/docs/installation.md
	@echo "3. Wait 5-10 minutes for first-time model downloads" >> $(RELEASE_DIR)/docs/installation.md
	@echo "4. Verify: Ollama (localhost:11434), Whisper (localhost:9000)" >> $(RELEASE_DIR)/docs/installation.md
	
	@echo "✅ Documentation created"

create-scripts: setup-release-dir ## Create installation and setup scripts
	@echo "🔧 Creating setup scripts..."
	@echo "#!/bin/bash" > $(RELEASE_DIR)/scripts/install.sh
	@echo "# Clipwise Installation Script" >> $(RELEASE_DIR)/scripts/install.sh
	@echo "set -e" >> $(RELEASE_DIR)/scripts/install.sh
	@echo "echo '🚀 Setting up Clipwise AI services...'" >> $(RELEASE_DIR)/scripts/install.sh
	@echo "cd docker" >> $(RELEASE_DIR)/scripts/install.sh
	@echo "docker-compose pull" >> $(RELEASE_DIR)/scripts/install.sh
	@echo "docker-compose up -d" >> $(RELEASE_DIR)/scripts/install.sh
	@echo "echo '✅ Services started! Launch Clipwise app and configure in Settings.'" >> $(RELEASE_DIR)/scripts/install.sh
	@chmod +x $(RELEASE_DIR)/scripts/install.sh
	
	@echo "#!/bin/bash" > $(RELEASE_DIR)/scripts/setup-models.sh
	@echo "# Download AI models" >> $(RELEASE_DIR)/scripts/setup-models.sh
	@echo "echo '📥 Downloading AI models...'" >> $(RELEASE_DIR)/scripts/setup-models.sh
	@echo "docker exec drillbit-ollama ollama pull llava:latest" >> $(RELEASE_DIR)/scripts/setup-models.sh
	@echo "docker exec drillbit-ollama ollama pull qllama/bge-large-en-v1.5:latest" >> $(RELEASE_DIR)/scripts/setup-models.sh
	@echo "docker exec drillbit-ollama ollama pull tinyllama:latest" >> $(RELEASE_DIR)/scripts/setup-models.sh
	@echo "echo '✅ Models downloaded!'" >> $(RELEASE_DIR)/scripts/setup-models.sh
	@chmod +x $(RELEASE_DIR)/scripts/setup-models.sh
	
	@echo "✅ Setup scripts created"

release: package copy-assets create-docs create-scripts ## Create a complete release
	@echo "🎉 Release v$(VERSION) created successfully!"
	@echo ""
	@echo "📁 Release location: $(RELEASE_DIR)"
	@echo "📦 Application: $(RELEASE_DIR)/releases/v$(VERSION)/"
	@echo "📚 Documentation: $(RELEASE_DIR)/docs/"
	@echo "🔧 Scripts: $(RELEASE_DIR)/scripts/"
	@echo ""
	@echo "🚀 Ready for distribution!"

dev-release: package-dev copy-assets create-docs create-scripts ## Create a development release
	@echo "🎉 Development release v$(VERSION) created successfully!"
	@echo "⚠️  This build includes development features and debug mode"

# Platform-specific builds (for CI/CD)
build-mac: build ## Build for macOS
	@echo "🍎 Building for macOS..."
	npm run electron:build -- --mac
	
build-windows: build ## Build for Windows  
	@echo "🪟 Building for Windows..."
	npm run electron:build -- --win

build-linux: build ## Build for Linux
	@echo "🐧 Building for Linux..."
	npm run electron:build -- --linux

all-platforms: clean install build ## Build for all platforms (requires platform-specific tools)
	@echo "🌍 Building for all platforms..."
	npm run electron:build:all
	$(MAKE) copy-assets
	$(MAKE) create-docs
	$(MAKE) create-scripts
	@echo "🎉 Multi-platform release completed!"

# Development helpers
dev: ## Start development server
	@if [ -f $(ENV_DEV) ]; then \
		export $$(cat $(ENV_DEV) | xargs) && npm run dev; \
	else \
		npm run dev; \
	fi

test: ## Run tests
	npm test

lint: ## Run linter
	npm run lint

generate-icons: ## Generate app icons from source logo (uses macOS sips)
	@echo "🎨 Generating app icons from source logo..."
	@if [ ! -f public/icons/clipwise-transparent.png ]; then \
		echo "❌ Source logo not found at public/icons/clipwise-transparent.png"; \
		echo "📋 Please run 'make make-logo-transparent' first"; \
		exit 1; \
	fi
	@mkdir -p public/icons
	@echo "📐 Generating icon sizes with sips..."
	@sips -z 16 16 public/icons/clipwise-transparent.png --out public/icons/icon-16.png >/dev/null
	@sips -z 32 32 public/icons/clipwise-transparent.png --out public/icons/icon-32.png >/dev/null
	@sips -z 64 64 public/icons/clipwise-transparent.png --out public/icons/icon-64.png >/dev/null
	@sips -z 128 128 public/icons/clipwise-transparent.png --out public/icons/icon-128.png >/dev/null
	@sips -z 256 256 public/icons/clipwise-transparent.png --out public/icons/icon-256.png >/dev/null
	@sips -z 512 512 public/icons/clipwise-transparent.png --out public/icons/icon-512.png >/dev/null
	@echo "✅ All icons generated successfully!"
	@ls -lh public/icons/icon-*.png | awk '{print "📐 " $$9 ": " $$5}'

make-logo-transparent: ## Make logo background transparent (requires ImageMagick)
	@echo "🎨 Making logo background transparent..."
	@if ! command -v magick >/dev/null 2>&1; then \
		echo "❌ ImageMagick not found. Install with: brew install imagemagick"; \
		exit 1; \
	fi
	@./scripts/make-logo-transparent.sh

# Default target
all: release
