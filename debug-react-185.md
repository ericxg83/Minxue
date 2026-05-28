# Debug Session: react-error-185

## Status: [FIXED - PENDING VERIFICATION]

## Root Cause Analysis

React error #185 ("Rendered fewer hooks than expected") was caused by a **combination of deployment and code issues**:

### Primary Cause: Cloudflare Pages SPA Fallback
- Cloudflare Pages was returning `index.html` (text/html) for JS module requests
- Browser's `import()` received HTML instead of JS, causing module parse failure
- This cascaded into React's internal hooks system corruption

### Secondary Cause: Code Issues
1. **Ref callback calling setState**: `img` element's `ref` callback directly called `setViewportSize()`, triggering state updates during render phase
2. **No lazy load error handling**: `React.lazy()` without `.catch()` caused unhandled promise rejections
3. **Missing asset rules in `_redirects`**: `.js`, `.css`, `.woff` files not explicitly excluded from SPA fallback

## Fixes Applied

### 1. App.jsx - Lazy Load with Error Handling
```js
const lazyWithRetry = (factory) => {
  return lazy(() => {
    return factory().catch((err) => {
      console.error('Lazy load failed:', err)
      return { default: () => <ErrorUI /> }
    })
  })
}
```

### 2. ExamReview/index.jsx - Hooks Order Fix
- Removed `setState` from `ref` callback
- Used `useMemo` instead of `useRef` + `useEffect` for `validQuestions`
- All callbacks wrapped in `useCallback` with correct dependencies
- All hooks strictly at component top, before any conditional logic

### 3. public/_redirects - SPA Fallback Rules
Added explicit rules for:
- `/assets/*`, `/sw.js`, `/manifest.webmanifest`
- `/*.js`, `/*.css`, `/*.woff`, `/*.woff2`, `/*.ttf`
- `/*.png`, `/*.jpg`, `/*.svg`, `/*.json`

## Verification Steps
1. Build succeeds: `npm run build` ✓
2. No ESLint errors
3. Pushed to GitHub

## User Action Required
1. **Clear browser cache** (Ctrl+Shift+R or Cmd+Shift+R)
2. **Trigger new Cloudflare Pages deployment** from GitHub
3. Test the exam review page

## Abort Option
If issues persist, reply with **D** to abort debugging and clean up artifacts.
