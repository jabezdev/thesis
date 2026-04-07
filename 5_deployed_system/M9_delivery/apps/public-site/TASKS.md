# Tasks: Public Site (panahon.live) Enhancement

This document tracks the progress of unimplemented features and UI/UX improvements for the public weather site.

- [ ] **Infrastructure & Setup**
    - [ ] Add `convex` dependency to `apps/public-site/package.json`
    - [ ] Create `convex/nodes.ts` with `getNodeByNodeId` query
    - [ ] Setup `ConvexClientProvider` in `apps/public-site/src/main.tsx`
- [ ] **Core Functionality**
    - [ ] Integrate Convex metadata (Station Name, Location) into the UI
    - [ ] Implement multi-metric switching for the chart (Temp, Humidity, Rain)
    - [ ] Add Dark Mode toggle (sync with `localStorage`)
- [ ] **UI/UX Polish**
    - [ ] Redesign Header with Branding & Node Info
    - [ ] Refactor Current Conditions to use `@panahon/ui` `Stats` component
    - [ ] Enhance Chart with better colors and labels for each metric
    - [ ] Implement graceful Loading and Error states for Firebase/Convex
- [ ] **Data Integrity**
    - [ ] Remove hardcoded `--` from wind (hardware not ready)
    - [ ] Verify node_1 hardcoding as primary pilot
- [ ] **Optimization & Cleanup**
    - [ ] Cleanup dead/unused imports (`Stats`, `Wind`, etc.) in `App.tsx`
    - [ ] Update `index.html` with proper title and SEO meta tags
    - [ ] Responsive UI audit (verify on small screens)
