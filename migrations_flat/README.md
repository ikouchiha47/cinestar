# Unified Migration System

This directory contains all database migrations in a single, flat structure with proper chronological ordering.

## Migration Order:

1. **001_create_video_tables.sql** - Video database: Core video tables
2. **002_create_media_tables.sql** - Media database: Core media tables  
3. **003_setup_vector_extensions.sql** - Media database: Vector search setup
4. **004_add_reconstructed_scene.sql** - Video database: Scene reconstruction
5. **005_fix_fts_reconstructed_scene.sql** - Video database: FTS fixes
6. **006_add_multi_stage_embeddings.sql** - Video database: Multi-stage embeddings
7. **007_create_scene_reconstruction_jobs.sql** - Media database: Job system
8. **008_fix_delete_trigger.sql** - Media database: Trigger fixes
9. **009_progressive_refinement.sql** - Video database: Progressive refinement
10. **010_enhance_job_descriptions.sql** - Media database: Job enhancements
11. **011_fix_remaining_item_id_issues.sql** - Media database: Item ID fixes
12. **012_fix_fts_table_configuration.sql** - Media database: FTS configuration
13. **013_fix_foreign_key_constraints.sql** - Video database: Foreign key fixes

## Database Targets:

- **Video Database**: `~/.driller/video-rag.db`
- **Media Database**: `~/.clipwise/vector.db`

## Usage:

Each migration file contains a comment indicating which database it targets.
The unified migration runner will apply migrations to the correct database based on the content.

## Benefits of Flat Structure:

- ✅ Single source of truth for all migrations
- ✅ Clear chronological order
- ✅ No confusion about which migration system to use
- ✅ Easy to track what was applied when
- ✅ Prevents the foreign key constraint issues we had
