# TASKS: Admin Console Overhaul

## Phase 1: Foundation & Auth
- [ ] Initialize `react-router-dom` and setup basic routing.
- [ ] Setup Clerk and Convex providers in `main.tsx`.
- [ ] Create an `Authenticated` wrapper for all admin routes.
- [ ] Implement a `Layout` component with the sidebar.

## Phase 2: Convex Backend
- [ ] Create `convex/nodes.ts` (list, create, updateCalibration).
- [ ] Create `convex/users.ts` (list, updateRole).
- [ ] Create `convex/alerts.ts` (list, resolve).

## Phase 3: core Pages & CRUD
- [ ] **Overview**: Real stats from Convex (node counts, alert counts).
- [ ] **Inventory**: Node table with status.
    - [ ] "Add New Node" modal (MAC, ID, etc.).
- [ ] **Calibration**: Per-node form for scalar/offset values.
- [ ] **User Access**: User list with "Edit Role" modal.
- [ ] **Alerts**: History log with "Resolve" buttons.
- [ ] **Settings**: UI Toggles & Metadata.

## Phase 4: Polish & Verify
- [ ] Responsive design check.
- [ ] Error handling for Convex/Clerk.
- [ ] Build and verify.
