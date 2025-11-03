# Cloud Migration Cost Analysis: Drillbit

**Date:** 2025-10-12  
**Status:** Analysis  
**Purpose:** Evaluate cost and effort of migrating compute and storage to cloud

---

## Executive Summary

**Current Architecture:** 100% local (Ollama + SQLite + local storage)  
**Proposed Architecture:** Cloud-based compute + storage with thin client

**Key Findings:**
- **Development Effort:** 4-6 weeks for full migration
- **Monthly Cost (100 users):** $2,500 - $8,000/month
- **Monthly Cost (1,000 users):** $15,000 - $45,000/month
- **Break-even:** Users willing to pay $15-45/month to avoid local setup

---

## Current Local Architecture

### Compute Requirements (Per User)

| Component | Model/Tool | Purpose | Local Resource |
|-----------|-----------|---------|----------------|
| **Transcription** | Whisper (base) | Audio → Text | CPU: 38x real-time |
| **Visual Captioning** | Moondream:v2 (2B) | Keyframes → Captions | GPU: ~2s per image |
| **Scene Reconstruction** | Llama 3.2 (3B) | Multi-modal synthesis | GPU: ~3s per segment |
| **Text Embeddings** | BGE-large (335M) | Text → 1024D vectors | GPU: ~500ms per query |
| **Search Embeddings** | BGE-large (335M) | Query → vectors | GPU: ~500ms per search |

### Storage Requirements (Per User)

| Data Type | Size per Hour of Video | Notes |
|-----------|------------------------|-------|
| **Original Video** | ~500MB - 2GB | User's own files |
| **Transcriptions** | ~50KB | Plain text |
| **Keyframes** | ~2MB (4 per 5min) | JPEG compressed |
| **Embeddings** | ~5MB | 1024D float32 arrays |
| **Metadata** | ~500KB | SQLite databases |
| **Total Overhead** | ~8MB per hour | Excluding original video |

**Typical User Library:**
- 100 hours of video → 800MB overhead
- 1,000 hours of video → 8GB overhead
- 10,000 hours of video → 80GB overhead

---

## Cloud Migration Architecture

### Option 1: Managed AI Services (OpenAI, Anthropic, etc.)

```
┌─────────────────────────────────────────────────────────────┐
│                    Electron Client (Thin)                   │
│  - File upload/download                                     │
│  - Search UI                                                │
│  - Video player                                             │
└─────────────────────────────────────────────────────────────┘
                            ↓ HTTPS
┌─────────────────────────────────────────────────────────────┐
│                   Backend API (Node.js/Go)                  │
│  - Job queue management                                     │
│  - User authentication                                      │
│  - API orchestration                                        │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                    External AI Services                     │
│  - OpenAI Whisper API (transcription)                       │
│  - OpenAI GPT-4 Vision (captioning)                         │
│  - OpenAI Embeddings (text-embedding-3-large)               │
│  - OpenAI GPT-4 (scene reconstruction)                      │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                    Cloud Storage                            │
│  - S3 (videos, keyframes)                                   │
│  - PostgreSQL + pgvector (metadata, embeddings)             │
└─────────────────────────────────────────────────────────────┘
```

### Option 2: Self-Hosted AI (GPU Instances)

```
┌─────────────────────────────────────────────────────────────┐
│                    Electron Client (Thin)                   │
└─────────────────────────────────────────────────────────────┘
                            ↓ HTTPS
┌─────────────────────────────────────────────────────────────┐
│                   Backend API + Job Queue                   │
│  - Redis (job queue)                                        │
│  - PostgreSQL (metadata)                                    │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│              GPU Worker Instances (Auto-scaling)            │
│  - Whisper (faster-whisper on GPU)                          │
│  - vLLM (Moondream, Llama 3.2, BGE-large)                   │
│  - FFmpeg (video processing)                                │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                    Cloud Storage                            │
│  - S3 (videos, keyframes)                                   │
│  - PostgreSQL + pgvector (embeddings)                       │
└─────────────────────────────────────────────────────────────┘
```

---

## Cost Breakdown

### Option 1: Managed AI Services (OpenAI)

#### Per-Video Processing Costs (60-minute video)

| Operation | API | Volume | Unit Cost | Total Cost |
|-----------|-----|--------|-----------|------------|
| **Transcription** | Whisper API | 60 min audio | $0.006/min | $0.36 |
| **Keyframe Captioning** | GPT-4 Vision | 48 images (4/5min) | $0.01/image | $0.48 |
| **Scene Reconstruction** | GPT-4o-mini | 12 calls (1/5min) | $0.15/1M tokens (~500 tokens/call) | $0.001 |
| **Text Embeddings** | text-embedding-3-large | 12 segments | $0.13/1M tokens (~200 tokens/segment) | $0.0003 |
| **Search Embeddings** | text-embedding-3-large | 1 query | $0.13/1M tokens (~20 tokens) | $0.000003 |
| **Total per 60min video** | | | | **$0.84** |

#### Monthly Costs (100 Active Users)

**Assumptions:**
- Average user: 10 hours of new video/month
- Average user: 50 searches/month
- Storage: 100 hours of video per user (accumulated)

| Cost Category | Calculation | Monthly Cost |
|---------------|-------------|--------------|
| **Video Processing** | 100 users × 10 hours × $0.84/hour | $840 |
| **Search Queries** | 100 users × 50 queries × $0.000003 | $0.02 |
| **S3 Storage** | 100 users × 100 hours × 1GB/hour × $0.023/GB | $230 |
| **S3 Bandwidth** | 100 users × 10 hours upload × 1GB × $0.09/GB | $90 |
| **PostgreSQL (RDS)** | db.t3.medium (2vCPU, 4GB) | $60 |
| **Backend API** | 2× t3.small instances | $30 |
| **Redis** | ElastiCache t3.micro | $15 |
| **Total (100 users)** | | **$1,265/month** |
| **Per User** | | **$12.65/month** |

#### Monthly Costs (1,000 Active Users)

| Cost Category | Calculation | Monthly Cost |
|---------------|-------------|--------------|
| **Video Processing** | 1,000 users × 10 hours × $0.84/hour | $8,400 |
| **Search Queries** | 1,000 users × 50 queries × $0.000003 | $0.15 |
| **S3 Storage** | 1,000 users × 100 hours × 1GB/hour × $0.023/GB | $2,300 |
| **S3 Bandwidth** | 1,000 users × 10 hours upload × 1GB × $0.09/GB | $900 |
| **PostgreSQL (RDS)** | db.r5.xlarge (4vCPU, 32GB) + read replica | $600 |
| **Backend API** | 4× t3.medium instances (load balanced) | $120 |
| **Redis** | ElastiCache r5.large (cluster mode) | $180 |
| **CDN (CloudFront)** | 1TB/month video streaming | $85 |
| **Total (1,000 users)** | | **$12,585/month** |
| **Per User** | | **$12.59/month** |

---

### Option 2: Self-Hosted AI (GPU Instances)

#### Infrastructure Costs

| Component | Instance Type | Specs | Hourly Cost | Monthly Cost (24/7) |
|-----------|--------------|-------|-------------|---------------------|
| **GPU Worker (Base)** | AWS g5.xlarge | 1× A10G (24GB), 4vCPU, 16GB RAM | $1.006/hr | $730 |
| **GPU Worker (Scale)** | AWS g5.2xlarge | 1× A10G (24GB), 8vCPU, 32GB RAM | $1.212/hr | $880 |
| **Backend API** | t3.medium | 2vCPU, 4GB RAM | $0.042/hr | $30 |
| **PostgreSQL** | db.t3.medium | 2vCPU, 4GB RAM | $0.082/hr | $60 |
| **Redis** | ElastiCache t3.micro | 1vCPU, 0.5GB RAM | $0.017/hr | $12 |

#### Per-Video Processing Costs (60-minute video)

**GPU Performance (g5.xlarge with vLLM):**
- Whisper (faster-whisper): ~10x real-time = 6 minutes
- Moondream captioning: ~0.5s per image × 48 = 24 seconds
- Llama 3.2 scene reconstruction: ~1s per segment × 12 = 12 seconds
- BGE-large embeddings: ~0.1s per segment × 12 = 1.2 seconds
- **Total processing time:** ~7 minutes

**Cost per video:** $1.006/hr × (7/60) = **$0.12**

#### Monthly Costs (100 Active Users)

**Assumptions:**
- 1× g5.xlarge GPU worker (can process ~200 hours/month)
- Peak usage: Auto-scale to 2× workers during business hours (8hrs/day)

| Cost Category | Calculation | Monthly Cost |
|---------------|-------------|--------------|
| **GPU Workers (Base)** | 1× g5.xlarge × 730 hours | $730 |
| **GPU Workers (Scale)** | 1× g5.xlarge × 240 hours (8hr/day) | $240 |
| **Backend API** | 2× t3.small | $30 |
| **PostgreSQL** | db.t3.medium | $60 |
| **Redis** | ElastiCache t3.micro | $12 |
| **S3 Storage** | 100 users × 100 hours × 1GB × $0.023/GB | $230 |
| **S3 Bandwidth** | 100 users × 10 hours × 1GB × $0.09/GB | $90 |
| **Total (100 users)** | | **$1,392/month** |
| **Per User** | | **$13.92/month** |

#### Monthly Costs (1,000 Active Users)

**Assumptions:**
- 3× g5.xlarge GPU workers (base load)
- Auto-scale to 6× workers during peak (8hrs/day)

| Cost Category | Calculation | Monthly Cost |
|---------------|-------------|--------------|
| **GPU Workers (Base)** | 3× g5.xlarge × 730 hours | $2,190 |
| **GPU Workers (Scale)** | 3× g5.xlarge × 240 hours | $720 |
| **Backend API** | 4× t3.medium | $120 |
| **PostgreSQL** | db.r5.xlarge + replica | $600 |
| **Redis** | ElastiCache r5.large | $180 |
| **S3 Storage** | 1,000 users × 100 hours × 1GB × $0.023/GB | $2,300 |
| **S3 Bandwidth** | 1,000 users × 10 hours × 1GB × $0.09/GB | $900 |
| **CDN** | 1TB/month | $85 |
| **Total (1,000 users)** | | **$7,095/month** |
| **Per User** | | **$7.10/month** |

---

## Development Effort Estimate

### Phase 1: Backend Infrastructure (2 weeks)
- **API Server:** Express/Fastify with authentication
- **Job Queue:** Bull/BullMQ with Redis
- **Database:** PostgreSQL + pgvector setup
- **File Upload:** S3 presigned URLs, multipart upload
- **User Management:** Auth0/Clerk integration or custom JWT

**Effort:** 80 hours (1 senior backend engineer)

### Phase 2: AI Service Integration (2 weeks)
- **Option 1 (Managed):** OpenAI SDK integration
  - Whisper API client
  - GPT-4 Vision client
  - Embeddings client
  - Error handling + retries
  
- **Option 2 (Self-hosted):** vLLM deployment
  - Docker containers for Whisper, Moondream, Llama
  - vLLM server setup with batching
  - GPU instance provisioning
  - Model loading + optimization

**Effort:** 80 hours (1 ML engineer)

### Phase 3: Client Refactoring (1.5 weeks)
- **Remove Local Processing:** Strip out Ollama, Whisper, FFmpeg
- **API Client:** Axios/fetch wrapper with retry logic
- **File Upload UI:** Progress tracking, chunked uploads
- **Streaming Results:** WebSocket for real-time job updates
- **Offline Mode:** Queue uploads for when online

**Effort:** 60 hours (1 frontend engineer)

### Phase 4: Migration Tools (0.5 weeks)
- **Data Export:** Export local embeddings to cloud format
- **Bulk Upload:** Script to upload existing videos
- **Database Migration:** SQLite → PostgreSQL converter

**Effort:** 20 hours (1 backend engineer)

### Phase 5: Testing + Deployment (1 week)
- **Load Testing:** Simulate 100-1000 concurrent users
- **Cost Monitoring:** CloudWatch dashboards
- **Auto-scaling:** Configure EC2/ECS auto-scaling policies
- **Monitoring:** Sentry, DataDog, or CloudWatch

**Effort:** 40 hours (1 DevOps engineer)

### Total Development Effort
- **Total Hours:** 280 hours
- **Timeline:** 4-6 weeks (with 2-3 engineers in parallel)
- **Cost (Contractors @ $100/hr):** $28,000
- **Cost (Full-time team):** ~1.5 months of team capacity

---

## Cost Comparison Summary

### Per-User Monthly Cost

| User Count | Local (Current) | Managed AI (OpenAI) | Self-Hosted GPU |
|------------|----------------|---------------------|-----------------|
| **1 user** | $0 (one-time hardware) | $12.65 | $13.92 |
| **100 users** | $0 | $12.65 | $13.92 |
| **1,000 users** | $0 | $12.59 | $7.10 |
| **10,000 users** | $0 | $12.50 | $5.50 |

### Total Monthly Cost (Infrastructure)

| User Count | Local | Managed AI | Self-Hosted GPU |
|------------|-------|------------|-----------------|
| **100 users** | $0 | $1,265 | $1,392 |
| **1,000 users** | $0 | $12,585 | $7,095 |
| **10,000 users** | $0 | $125,000 | $45,000 |

---

## Break-Even Analysis

### Subscription Pricing Required

To cover cloud costs, you'd need to charge:

**Managed AI (OpenAI):**
- 100 users: $12.65/user/month (break-even)
- 1,000 users: $12.59/user/month
- Recommended pricing: **$15-20/month** (25-60% margin)

**Self-Hosted GPU:**
- 100 users: $13.92/user/month (break-even)
- 1,000 users: $7.10/user/month
- Recommended pricing: **$10-15/month** (40-110% margin at scale)

### User Willingness to Pay

**Market Research Insights:**
- **Notion AI:** $10/month (simple text AI)
- **Descript:** $24/month (video transcription + editing)
- **Riverside.fm:** $24/month (video recording + transcription)
- **Otter.ai:** $16.99/month (transcription only)

**Drillbit Value Proposition:**
- Multi-modal video search (audio + visual)
- Local-first privacy option
- Semantic scene understanding
- Timestamp-based navigation

**Estimated Willingness to Pay:**
- **Privacy-conscious users:** $0 (prefer local-only)
- **Convenience users:** $15-25/month (cloud option)
- **Enterprise users:** $50-100/month (team features)

---

## Hybrid Architecture Option

### Best of Both Worlds

```
┌─────────────────────────────────────────────────────────────┐
│                    Drillbit Client                          │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Local Mode (Default)                                │  │
│  │  - Ollama (user's machine)                           │  │
│  │  - SQLite (local storage)                            │  │
│  │  - $0/month                                          │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Cloud Mode (Optional)                               │  │
│  │  - API calls to cloud backend                        │  │
│  │  - Sync to cloud storage                             │  │
│  │  - $15/month subscription                            │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### Hybrid Pricing Model

**Free Tier (Local-only):**
- ✅ Unlimited videos (user's storage)
- ✅ All AI features (user's compute)
- ✅ Local search
- ❌ No cloud sync
- ❌ No mobile access
- ❌ No team sharing

**Pro Tier ($15/month - Cloud):**
- ✅ Cloud processing (no Ollama needed)
- ✅ Cloud storage (100GB included)
- ✅ Mobile app access
- ✅ Cross-device sync
- ✅ Faster processing (GPU instances)
- ✅ Team sharing (up to 5 members)

**Enterprise Tier ($50/user/month):**
- ✅ Everything in Pro
- ✅ Unlimited storage
- ✅ Priority processing
- ✅ SSO/SAML
- ✅ Audit logs
- ✅ Dedicated support

### Revenue Projection (Hybrid Model)

**Assumptions:**
- 10,000 total users
- 80% free tier (local-only)
- 15% Pro tier ($15/month)
- 5% Enterprise tier ($50/month)

| Tier | Users | Monthly Revenue | Annual Revenue |
|------|-------|-----------------|----------------|
| **Free** | 8,000 | $0 | $0 |
| **Pro** | 1,500 | $22,500 | $270,000 |
| **Enterprise** | 500 | $25,000 | $300,000 |
| **Total** | 10,000 | **$47,500** | **$570,000** |

**Cloud Costs (1,500 Pro + 500 Enterprise = 2,000 cloud users):**
- Self-hosted GPU: ~$14,000/month
- **Gross Margin:** 70% ($33,500/month profit)

---

## Recommendations

### Short-term (3 months)
1. **Keep local-first as default** - Core value proposition
2. **Build cloud option as premium tier** - Optional convenience
3. **Start with managed AI (OpenAI)** - Faster to market, predictable costs
4. **Implement hybrid sync** - Best of both worlds

### Medium-term (6-12 months)
1. **Monitor cloud adoption rate** - Validate willingness to pay
2. **Migrate to self-hosted GPU** - Better margins at scale (>1,000 cloud users)
3. **Add team features** - Justify higher enterprise pricing
4. **Build mobile app** - Increase cloud tier value

### Long-term (12+ months)
1. **Multi-region deployment** - Reduce latency for global users
2. **Edge computing** - Process videos closer to users
3. **Federated learning** - Improve models without centralizing data
4. **Plugin marketplace** - Additional revenue stream

---

## Risk Assessment

### Technical Risks
- **Vendor lock-in:** OpenAI pricing changes
  - *Mitigation:* Abstract AI providers, support multiple backends
- **Data privacy:** User videos in cloud
  - *Mitigation:* End-to-end encryption, SOC2 compliance
- **Latency:** Slower than local processing
  - *Mitigation:* GPU instances, regional deployment

### Business Risks
- **Low conversion rate:** Users prefer free local tier
  - *Mitigation:* Add compelling cloud-only features (mobile, sharing)
- **High churn:** Users cancel after initial processing
  - *Mitigation:* Annual plans, ongoing value (new videos, re-indexing)
- **Competition:** Cloud-only competitors with lower prices
  - *Mitigation:* Differentiate on privacy, local-first option

---

## Conclusion

### ⚠️ CRITICAL INSIGHT: Don't Host Videos

**The upload model doesn't work for video apps.**

Users won't upload 100GB+ of videos to yet another platform when they already have:
- Google Drive (already paid for)
- Dropbox (already paid for)
- iCloud Photos (already paid for)

### Recommended Approach: **Mobile + Storage Integration**

Instead of hosting videos, **index them where they already are:**

```
User connects Google Drive → Drillbit indexes videos → User searches
                           (no upload required)
```

**Benefits:**
- ✅ **99% storage cost reduction** ($2.30/user → $0.014/user)
- ✅ **Zero friction onboarding** (2 minutes vs 2 hours of uploading)
- ✅ **Better UX** (mobile-first, where videos are captured)
- ✅ **Higher margins** (85% gross margin vs 70%)
- ✅ **Unique positioning** (only multi-cloud video search app)

**Revised Architecture:**
1. **Mobile app** (iOS/Android) - Primary interface
2. **Storage integrations** (Google Drive, Dropbox, iCloud, OneDrive)
3. **Cloud backend** - Process videos temporarily, store only metadata + embeddings
4. **No permanent video storage** - Videos stay in user's cloud

**Revised Pricing:**
- **Free tier:** 10 videos indexed
- **Pro tier:** $10/month (unlimited videos, 1 cloud storage)
- **Premium tier:** $15/month (all cloud storage, advanced search)
- **Team tier:** $50/user/month (team workspaces, API)

**Unit Economics (Pro tier @ $10/month):**
- Revenue: $10/month
- COGS: $1.50/month (processing + metadata only)
- Gross Margin: **85%**
- LTV/CAC: 8:1

**See:** `docs/STORAGE-INTEGRATION-STRATEGY.md` for full analysis

### Alternative: Desktop Local-First (Current)
Keep if:
- ✅ Target market is technical users (developers, researchers)
- ✅ Privacy is absolute requirement
- ✅ One-time purchase model ($50-100)
- ✅ No ongoing infrastructure costs

**Next Steps:**
1. **Validate storage integration hypothesis** (user interviews)
2. **Build mobile MVP** (iOS + Google Drive integration)
3. **Beta test** with 50 users
4. **Measure:** Time to first search, weekly usage, willingness to pay
5. **Decide:** Mobile-first vs Desktop-first vs Hybrid
