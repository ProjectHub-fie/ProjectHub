# Quick Configuration Guide - GitHub Widget

## 🎛️ Enable/Disable GitHub Features

### Disable Widget (Hero Section Icon)
**File**: `client/src/components/github-widget.tsx`  
**Line**: ~7

```typescript
const GITHUB_WIDGET_ENABLED = false; // ← Change to false to disable
```

### Disable Page (/github Route)
**File**: `client/src/pages/github.tsx`  
**Line**: ~8

```typescript
const GITHUB_PAGE_ENABLED = false; // ← Change to false to disable
```

---

## 🔒 Privacy Settings (Automatic)

✅ **Private repositories are automatically filtered out**  
✅ **Only public repos are displayed**  
✅ **No additional configuration needed**

---

## ⚡ Quick Test

After changing configuration:

1. **Save the file**
2. **Run**: `npm run build`
3. **Check**: Build succeeds with no errors
4. **Test**: Click GitHub icon or visit `/github`

---

## 📊 Current Configuration

| Feature | Status | Location |
|---------|--------|----------|
| Widget Modal | ✅ Enabled | `github-widget.tsx` line 7 |
| Full Page | ✅ Enabled | `github.tsx` line 8 |
| Private Repo Filter | ✅ Active | Both files |

---

## 🚨 Troubleshooting

**Widget shows "disabled" message?**
- Check `GITHUB_WIDGET_ENABLED` is `true`

**Page shows "disabled" state?**
- Check `GITHUB_PAGE_ENABLED` is `true`

**Runtime error when clicking icon?**
- ✅ Fixed! Component props simplified
- Ensure TypeScript compiles without errors
- Rebuild if needed: `npm run build`

**Build fails?**
- Verify TypeScript has no errors
- Check that both constants exist

**Private repos showing?**
- This shouldn't happen - filter is automatic
- Check GitHub API response includes `private` field

---

## 📝 Example Scenarios

### Scenario 1: Temporary Maintenance
```typescript
// Temporarily disable widget during updates
const GITHUB_WIDGET_ENABLED = false;
const GITHUB_PAGE_ENABLED = true; // Keep page accessible
```

### Scenario 2: Complete Disable
```typescript
// Disable all GitHub integration
const GITHUB_WIDGET_ENABLED = false;
const GITHUB_PAGE_ENABLED = false;
```

### Scenario 3: Production Ready
```typescript
// Normal operation - everything enabled
const GITHUB_WIDGET_ENABLED = true;
const GITHUB_PAGE_ENABLED = true;
```

---

## 🔧 Recent Fix

**Issue**: Runtime error when clicking GitHub icon  
**Cause**: Prop interface mismatch  
**Solution**: Simplified component props, using only global constant  
**Status**: ✅ Fixed

See [`GITHUB_WIDGET_FIX.md`](./GITHUB_WIDGET_FIX.md) for details.

---

**Need more help?** See [`GITHUB_WIDGET_CONFIGURATION.md`](./GITHUB_WIDGET_CONFIGURATION.md)
