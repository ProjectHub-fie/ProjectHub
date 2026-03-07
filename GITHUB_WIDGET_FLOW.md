# GitHub Widget - Visual Flow Guide

## User Interaction Flow

```
Hero Section
    ↓
[GitHub Icon Click]
    ↓
Widget Modal Opens (Compact View)
    ├── Shows: Profile summary + Top 5 repos
    ├── Buttons: "View Profile" | "Show All" | "Close"
    ↓
[Click "Show All"]
    ↓
Widget Modal (Full View)
    ├── Shows: Up to 6 recent repos with details
    ├── Button: "←" (back to compact)
    └── Each repo has link to GitHub
```

## Navigation Options

### Option 1: Widget Modal (Current Implementation)
**Access**: Click GitHub icon in hero section
**Best For**: Quick preview, minimal context switch

**Features**:
- ✅ Instant loading modal
- ✅ Curated repository list
- ✅ Keeps users on your site
- ✅ Consistent with Discord widget UX

### Option 2: Full Page (Available at `/github`)
**Access**: Direct navigation to `/github`
**Best For**: Detailed exploration, portfolio showcase

**Features**:
- ✅ Comprehensive repository grid (20 repos)
- ✅ Statistics dashboard
- ✅ Better for SEO
- ✅ Shareable URL

## Component Hierarchy

```
App
├── Router
│   ├── / → Home
│   │   └── HeroSection
│   │       └── GithubWidget (modal overlay)
│   └── /github → GithubPage
│       └── Full page repository viewer
└── ... other routes
```

## Responsive Behavior

### Mobile (< 768px)
- Widget: Single column layout
- Page: Single column cards
- Icons: Larger touch targets (48px min)

### Tablet (768px - 1024px)
- Widget: Optimized card layout
- Page: 2-column grid

### Desktop (> 1024px)
- Widget: Full multi-column display
- Page: 3-column grid
- Hover effects enabled

## Styling Features

### Animations
- `animate-in fade-in duration-200` - Modal appearance
- `zoom-in-95` - Smooth scale effect
- `hover:-translate-y-1` - Card elevation
- `transition-all duration-200` - Interactive elements

### Theme Integration
- Uses CSS variables from theme-provider
- Respects dark/light mode
- Consistent color palette
- Border and shadow system

## Data Flow

```
Component Mount
    ↓
useEffect Trigger
    ↓
Fetch from GitHub API
    ├── GET /users/rajroy1313
    └── GET /users/rajroy1313/repos
    ↓
Update State
    ├── setProfile()
    └── setRepos()
    ↓
Render UI
    ├── Loading Spinner (while fetching)
    ├── Success View (data loaded)
    └── Error View (if fetch fails)
```

## Performance Optimizations

1. **Lazy Loading**: Components use React.lazy()
2. **Memoization**: useEffect dependencies optimized
3. **Conditional Rendering**: Only show what's needed
4. **API Rate Limiting**: Public endpoints (60 req/hr)
5. **Image Optimization**: Avatar URLs from GitHub CDN

## Accessibility Features

- ✅ ARIA labels on buttons
- ✅ Keyboard navigation support
- ✅ Focus management in modals
- ✅ Screen reader friendly
- ✅ Semantic HTML structure

## Browser Support

- Chrome/Edge (latest 2 versions)
- Firefox (latest 2 versions)
- Safari (latest 2 versions)
- Mobile browsers (iOS Safari, Chrome Mobile)

## Error Handling

### API Failures
- Network errors → Show "Failed to load" message
- Rate limiting → Graceful degradation
- Invalid data → Fallback values

### User Feedback
- Loading spinners during fetch
- Clear error messages
- Retry options available
