# ADR-004: Integrated Video Player with Segment Navigation

## Status
Proposed

## Context
Currently, users can see video listings and search results, but there's no way to actually view the videos or navigate to specific segments that match their search queries. This creates a disconnect between search results and content consumption.

### Current State
- Video listing page shows video cards but clicking them has no action
- Search results show video segments but no way to view the actual content
- No video playback capability within the application
- Users cannot jump to specific timestamps mentioned in search results

### User Stories
1. **As a user browsing videos**, I want to click on a video card and see it play in a beautiful, integrated player
2. **As a user searching for content**, I want to see matching video segments and be able to jump directly to those timestamps
3. **As a user viewing search results**, I want to see the context around matching segments with easy navigation

## Decision
Implement an integrated video player with the following features:

### Core Components
1. **Glass-themed Video Player Modal**
   - Modern glassmorphism design consistent with app aesthetic
   - Standard video controls (play/pause, seek, volume, fullscreen)
   - Responsive design that works on different screen sizes

2. **Segment Navigation Panel** (Search Results Only)
   - List of matching segments below the video player
   - Each segment shows: timestamp, transcription excerpt, caption preview
   - Clickable timestamps that seek the video to that exact moment
   - Highlight the currently playing segment

3. **Context-Aware Player Behavior**
   - **Listing Page**: Simple video player with full video playback
   - **Search Page**: Video player + segment navigation panel
   - **Auto-seek**: When opened from search, automatically seek to first matching segment

### Technical Architecture

#### Frontend Components
```
VideoPlayerModal/
├── VideoPlayer.tsx           # Main video player component
├── SegmentNavigationPanel.tsx # Search results segment list
├── SegmentItem.tsx           # Individual segment with timestamp link
├── PlayerControls.tsx        # Custom video controls
└── styles/
    └── glass-theme.css       # Glassmorphism styling
```

#### Data Flow
```
Search Results → VideoPlayerModal
├── videoPath: string
├── segments?: VideoSegment[]  # Only for search results
├── initialTimestamp?: number  # Auto-seek on open
└── searchQuery?: string       # Highlight matching text
```

#### Video Segment Interface
```typescript
interface VideoSegment {
  id: string;
  startTime: number;
  endTime: number;
  transcription: string;
  caption: string;
  reconstructedScene: string;
  relevanceScore?: number;
}
```

### Implementation Plan

#### Phase 1: Core Video Player (Week 1)
- [ ] Create glassmorphism-themed video player modal
- [ ] Implement basic video controls and playback
- [ ] Add keyboard shortcuts (space, arrow keys, etc.)
- [ ] Integrate with video listing page
- [ ] Handle different video formats and error states

#### Phase 2: Segment Navigation (Week 2)
- [ ] Create segment navigation panel component
- [ ] Implement timestamp seeking functionality
- [ ] Add segment highlighting and auto-scroll
- [ ] Integrate with search results page
- [ ] Add search query highlighting in segment text

#### Phase 3: Enhanced Features (Week 3)
- [ ] Add segment preview thumbnails
- [ ] Implement smooth seeking animations
- [ ] Add segment bookmarking/favorites
- [ ] Performance optimizations for large segment lists
- [ ] Mobile responsiveness improvements

### Design Specifications

#### Glassmorphism Theme
- **Background**: `backdrop-blur-xl bg-black/20`
- **Borders**: `border border-white/10`
- **Shadows**: `shadow-2xl shadow-black/50`
- **Accent Colors**: Primary blue with glass overlay effects

#### Layout Structure
```
┌─────────────────────────────────────┐
│           Video Player              │
│  ┌─────────────────────────────┐   │
│  │                             │   │
│  │        Video Content        │   │
│  │                             │   │
│  └─────────────────────────────┘   │
│         [Controls Bar]              │
├─────────────────────────────────────┤
│        Segment Navigation           │ ← Only for search results
│  ⏰ 0:45 - "Camera setup scene"     │
│  ⏰ 2:30 - "Discussion about..."    │
│  ⏰ 5:15 - "Key moment when..."     │
└─────────────────────────────────────┘
```

### API Requirements

#### New IPC Handlers
```typescript
// Get video segments for search results
ipcMain.handle('video:getSegments', async (_, videoPath: string, searchQuery?: string))

// Get video metadata
ipcMain.handle('video:getMetadata', async (_, videoPath: string))
```

#### Database Queries
- Fetch segments by video path with search relevance scoring
- Get video duration and metadata
- Retrieve segment transcriptions and captions

### Success Metrics
1. **User Engagement**: Increased time spent viewing videos (target: +200%)
2. **Search Effectiveness**: Users successfully navigate to relevant segments (target: >80%)
3. **Performance**: Video player loads within 2 seconds
4. **Usability**: Segment seeking accuracy within ±1 second

### Risks and Mitigations

#### Technical Risks
- **Video Format Compatibility**: Mitigate with comprehensive format testing and fallback handling
- **Performance with Large Segment Lists**: Implement virtualization for 100+ segments
- **Seeking Accuracy**: Use precise timestamp indexing and buffering strategies

#### UX Risks
- **Modal Overwhelm**: Keep design clean with collapsible segment panel
- **Mobile Experience**: Ensure touch-friendly controls and responsive layout
- **Loading States**: Implement skeleton screens and progressive loading

### Dependencies
- **Video.js** or **React Player**: For robust video playback
- **Framer Motion**: For smooth animations and transitions
- **React Virtualized**: For efficient large segment list rendering

### Future Enhancements
- **Segment Thumbnails**: Generate and display preview images for each segment
- **Multi-video Playlists**: Queue related videos from search results
- **Segment Sharing**: Generate shareable links to specific video moments
- **Offline Playback**: Cache videos for offline viewing
- **Subtitles/Captions**: Overlay generated captions on video

## Consequences

### Positive
- **Enhanced User Experience**: Seamless video consumption within the app
- **Improved Search Value**: Direct navigation to relevant content moments
- **Increased Engagement**: Users spend more time with discovered content
- **Professional Feel**: Glass-themed player elevates app aesthetics

### Negative
- **Increased Complexity**: More components and state management
- **Performance Overhead**: Video processing and segment rendering
- **Storage Requirements**: Potential need for video caching
- **Browser Compatibility**: Video format and codec considerations

### Neutral
- **Development Time**: ~3 weeks for full implementation
- **Bundle Size**: Moderate increase due to video player dependencies
- **Testing Complexity**: Need for video playback testing across platforms

---

**Decision Date**: 2025-09-29  
**Stakeholders**: Development Team, UX Design  
**Review Date**: 2025-10-06 (after Phase 1 completion)
