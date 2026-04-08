import React from 'react'
import ReactDOM from 'react-dom/client'
import { ClerkProvider, useAuth } from "@clerk/clerk-react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import { ConvexReactClient } from "convex/react";
import App from './App.tsx'
import { DashboardGuard } from './DashboardGuard.tsx'
import './index.css'

const convexUrl = (import.meta.env.VITE_CONVEX_URL as string).replace(/\/$/, "");
const convex = new ConvexReactClient(convexUrl);
const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

if (!PUBLISHABLE_KEY) {
  throw new Error("Missing Clerk Publishable Key");
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ClerkProvider publishableKey={PUBLISHABLE_KEY}>
      <ConvexProviderWithClerk client={convex} useAuth={useAuth}>
        <DashboardGuard>
          <App />
        </DashboardGuard>
      </ConvexProviderWithClerk>
    </ClerkProvider>
  </React.StrictMode>,
)
