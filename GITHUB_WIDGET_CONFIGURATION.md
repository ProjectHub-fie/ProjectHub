# GitHub Widget - Configuration & Privacy Guide

## Overview
The GitHub widget has been updated with enhanced privacy controls and configuration options to ensure only public repositories are displayed, with the ability to easily enable/disable the feature.

## 🔒 Privacy Features

### 1. Private Repository Filtering
Both the widget modal and full page now **automatically filter out private repositories**:

- **Widget Modal**: Fetches up to 20 repos, filters private ones, displays top 6 public repos
- **GitHub Page**: Fetches up to 50 repos, displays all public repositories
- **API Field**: Uses the `private` field from GitHub API response
- **Filter Logic**: `data.filter(repo => !repo.private)`

### 2. What's Protected
✅ Only **public repositories** are visible
✅ Private organization repositories remain hidden
✅ Sensitive project information stays secure
✅ Complies with GitHub repository visibility settings

## ⚙️ Configuration Options

### Global Enable/Disable Switch

Two configuration constants control the feature availability:

#### 1. Widget Configuration
**Location**: `/client/src/components/github-widget.tsx`
```typescript
const GITHUB_WIDGET_ENABLED = true; // Set to false to disable widget
```

#### 2. Page Configuration
**Location**: `/client/src/pages/github.tsx`
```typescript
const GITHUB_PAGE_ENABLED = true; // Set to false to disable page
```

### How to Disable

#### Option A: Disable Widget Only
1. Open `client/src/components/github-widget.tsx`
2. Change `GITHUB_WIDGET_ENABLED` to `false`
3. Save the file
4. Rebuild: `npm run build`

**Result**: The GitHub icon in hero section will show a "disabled" message when clicked.

#### Option B: Disable Page Only
1. Open `client/src/pages/github.tsx`
2. Change `GITHUB_PAGE_ENABLED` to `false`
3. Save the file
4. Rebuild: `npm run build`

**Result**: The `/github` route will display a disabled state page.

#### Option C: Disable Both
Set both constants to `false` to completely remove GitHub integration.

## 📊 Disabled State Behavior

### Widget Modal (When Disabled)
```
┌─────────────────────────────────┐
│  GitHub Organization        [X] │
├─────────────────────────────────┤
│                                 │
│   GitHub widget is currently    │
│          disabled               │
│                                 │
│         [ Close ]               │
│                                 │
└─────────────────────────────────┘
```

### GitHub Page (When Disabled)
```
┌─────────────────────────────────┐
│                                 │
│        [GitHub Icon]            │
│                                 │
│   GitHub Page is Disabled       │
│                                 │
│   This feature is currently     │
│        not available.           │
│                                 │
│      [← Back to Home]           │
│                                 │
└─────────────────────────────────┘
```

## 🔧 Technical Implementation

### Widget Component Flow
```typescript
useEffect(() => {
  if (!GITHUB_WIDGET_ENABLED) {
    setLoading(false);
    return;
  }

  fetch(`https://api.github.com/orgs/${username}/repos?sort=updated&per_page=20`)
    .then((res) => res.json())
    .then((data) => {
      // Filter out private repositories
      const publicRepos = data.filter((repo: RepoData) => !repo.private);
      setRepos(publicRepos.slice(0, 6));
      setLoading(false);
    });
}, [GITHUB_WIDGET_ENABLED]);
```

### Page Component Flow
```typescript
useEffect(() => {
  if (!GITHUB_PAGE_ENABLED) {
    setLoading(false);
    return;
  }

  fetch(`https://api.github.com/orgs/${username}/repos?sort=updated&per_page=50`)
    .then((res) => res.json())
    .then((data) => {
      const publicRepos = data.filter((repo: RepoData) => !repo.private);
      setRepos(publicRepos);
      setLoading(false);
    });
}, [GITHUB_PAGE_ENABLED]);
```

### Interface Updates
```typescript
interface RepoData {
  id: number;
  name: string;
  description: string;
  stargazers_count: number;
  forks_count: number;
  html_url: string;
  language: string;
  updated_at: string;
  private: boolean; // ← Added for filtering
}
```

## 🎯 Use Cases

### When to Disable
- **Maintenance**: Temporarily disable during GitHub API issues
- **Rebranding**: Hide while updating organization information
- **Privacy Review**: Disable during internal review of public repos
- **Performance**: Reduce API calls during high traffic
- **Development**: Test other features without GitHub dependency

### When to Enable
- **Portfolio Display**: Showcase organization projects
- **Recruitment**: Demonstrate active development
- **Transparency**: Show open-source contributions
- **Engagement**: Encourage GitHub community interaction

## 📁 Files Modified

### Component Files
1. **`/client/src/components/github-widget.tsx`**
   - Added `GITHUB_WIDGET_ENABLED` constant
   - Added `private` field to `RepoData` interface
   - Implemented private repo filtering logic
   - Added disabled state UI

2. **`/client/src/pages/github.tsx`**
   - Added `GITHUB_PAGE_ENABLED` constant
   - Added `private` field to `RepoData` interface
   - Implemented private repo filtering logic
   - Added disabled state page layout

### API Endpoints Used
- `https://api.github.com/orgs/ProjectHub-fie` - Organization metadata
- `https://api.github.com/orgs/ProjectHub-fie/repos` - Repositories list

## 🔍 Testing Checklist

- [ ] Verify private repos don't appear in widget
- [ ] Verify private repos don't appear on page
- [ ] Test widget disabled state
- [ ] Test page disabled state
- [ ] Confirm build succeeds with both states
- [ ] Check responsive design on mobile
- [ ] Validate GitHub Readme Stats still displays

## 🚀 Build Verification

After making changes:
```bash
npm run build
```

Expected output:
```
✓ built in X.XXs
```

No TypeScript errors should occur.

## 💡 Best Practices

1. **Always test with both public and private repos** during development
2. **Keep configuration constants at the top** of files for easy access
3. **Document any API parameter changes** in this file
4. **Test disabled state regularly** to ensure it renders correctly
5. **Consider environment variables** for production configuration (future enhancement)

## 🔮 Future Enhancements

Potential improvements for consideration:

1. **Environment Variable Control**
   ```typescript
   const GITHUB_WIDGET_ENABLED = process.env.REACT_APP_GITHUB_WIDGET === 'true';
   ```

2. **Admin Toggle UI**
   - Add admin panel to enable/disable without code changes
   - Real-time toggle without rebuild

3. **Selective Repository Display**
   - Manually curate which public repos to show
   - Pin featured repositories to top

4. **Caching Strategy**
   - Cache filtered results to reduce API calls
   - Implement stale-while-revalidate pattern

5. **Fallback Content**
   - Show placeholder when no public repos exist
   - Display "Coming Soon" message during initial setup

## 📞 Support

If you encounter issues:
1. Check that `GITHUB_WIDGET_ENABLED` / `GITHUB_PAGE_ENABLED` is set correctly
2. Verify GitHub API is accessible (no network blocks)
3. Ensure organization name is correct: `ProjectHub-fie`
4. Review browser console for API errors
5. Rebuild the project after any configuration changes

---

**Last Updated**: March 6, 2026
**Version**: 2.0 (with privacy filtering)
