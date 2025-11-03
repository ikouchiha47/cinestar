# Search Debug Report - "cold" Query Returns 0 Results

## Problem Statement

Searching for "cold" returns 0 results despite having 43 images indexed.

## Current Behavior (from logs)

```
[IMAGE-HYBRID] Starting hybrid search for: "cold"
[IMAGE-HYBRID] alpha=0.7, minSimilarity=0.5, minVectorSim=0.6, maxDistance=0, limit=120
[IMAGE-HYBRID] Raw results - Vector: 43/360, FTS: 0
[IMAGE-HYBRID] After vector cutoff (≥0.6): 5 vector results
[IMAGE-HYBRID] Quality filtered: 0 results (≥0.5)
```

## Analysis

### Issue 1: FTS Returns 0 Results
- **FTS: 0** means Full-Text Search found no matches for "cold"
- This is suspicious - if images have captions, FTS should find something
- **Possible causes:**
  1. FTS index is empty (captions not indexed)
  2. FTS query transformation is broken
  3. FTS table schema mismatch

### Issue 2: Hybrid Scoring Too Strict
- **5 vector results** passed the vector similarity cutoff (≥0.6)
- **0 results** passed the hybrid quality filter (≥0.5)
- **Why?** Hybrid score = `0.7 × vectorScore + 0.3 × ftsScore`
  - If FTS score = 0, then hybrid = `0.7 × vectorScore`
  - For hybrid ≥ 0.5, need vectorScore ≥ 0.714
  - But vector cutoff is only 0.6, so results with 0.6-0.714 are filtered out!

### Issue 3: Poor Logging
Current logs don't show:
- ❌ Actual vector scores for the 5 results
- ❌ Actual FTS scores (all 0, but why?)
- ❌ Actual hybrid scores that failed the filter
- ❌ FTS query transformation
- ❌ Whether FTS index has any data

## Recent Changes

### Change 1: FTS Update Method (image-search-writer.ts)
```diff
- // FTS5 doesn't support UPSERT, so delete then insert
- this.db.prepare(`DELETE FROM image_fts WHERE item_id = ?`).run(itemId);
- this.db.prepare(`INSERT INTO image_fts(item_id, text) VALUES (?, ?)`).run(itemId, caption);
+ // FTS5 supports UPDATE
+ const result = this.db.prepare(`UPDATE image_fts SET text = ? WHERE item_id = ?`).run(caption, itemId);
+ if (result.changes === 0) {
+   this.db.prepare(`INSERT INTO image_fts(item_id, text) VALUES (?, ?)`).run(itemId, caption);
+ }
```

**Impact:** This change is correct and shouldn't cause issues. UPDATE is better than DELETE+INSERT.

### Change 2: Method Rename
```diff
- this.updateFTS(itemId, combinedText);
+ this.updateCaption(itemId, combinedText);
```

**Impact:** Just a rename, no functional change.

## Root Cause Hypothesis

**Primary Suspect: FTS Index is Empty**

The FTS returning 0 results suggests the index might be empty. This could happen if:
1. Images were indexed before the FTS update method was fixed
2. The `updateCaption()` method isn't being called during indexing
3. There's a schema mismatch between `image_fts` table and the query

## Fixes Applied

### Fix 1: Enhanced Logging
Added detailed logging to show:
- ✅ FTS query transformation
- ✅ FTS match count
- ✅ Top 10 scored results with individual scores
- ✅ Pass/fail status for each result
- ✅ Suggestions when no results pass filter

### Fix 2: Show Scores Before Filtering
Now logs all scored results BEFORE applying quality filter, so we can see:
- Vector scores
- FTS scores  
- Hybrid scores
- Which results failed and why

## Next Steps

1. **Restart app** to apply logging changes
2. **Search for "cold"** again
3. **Check logs** for:
   - FTS query transformation
   - FTS match count (should be > 0 if index has data)
   - Actual scores for the 5 vector results
   - Why hybrid scores are < 0.5

4. **If FTS index is empty:**
   - Check if `updateCaption()` is called during image indexing
   - Verify `image_fts` table has data: `SELECT COUNT(*) FROM image_fts`
   - Re-index images to populate FTS

5. **If FTS has data but query fails:**
   - Check FTS query transformation (might be too strict)
   - Try simpler query: `cold*` instead of `cold OR`

6. **If hybrid scoring is the issue:**
   - Lower `minSimilarity` from 0.5 to 0.4
   - Or adjust `alpha` to weight vector more (0.8 instead of 0.7)
   - Or lower `minVectorSim` from 0.6 to 0.5

## Configuration Recommendations

Current thresholds might be too strict:
- `minVectorSim: 0.6` - Only keeps top 5/43 results
- `minSimilarity: 0.5` - Requires hybrid score ≥ 0.5
- `alpha: 0.7` - 70% vector, 30% FTS

**Suggested relaxed thresholds:**
```typescript
{
  minVectorSim: 0.5,      // Keep more vector candidates
  minSimilarity: 0.4,     // Lower hybrid threshold
  alpha: 0.75             // Weight vector slightly more
}
```

---

**Status**: Logging enhanced, awaiting test results  
**Priority**: HIGH - Search is broken  
**Next Action**: Restart app and check new logs
