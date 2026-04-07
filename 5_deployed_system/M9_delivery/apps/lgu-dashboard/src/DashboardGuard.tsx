import { useEffect } from "react";
import { SignIn, useUser } from "@clerk/clerk-react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";

export function DashboardGuard({ children }: { children: React.ReactNode }) {
  const { isLoaded, isSignedIn, user } = useUser();
  const convexUser = useQuery(api.users.current);
  const upsertUser = useMutation(api.users.upsertUser);

  // Sync Clerk → Convex on first sign-in
  useEffect(() => {
    if (isSignedIn && convexUser === null && user) {
      upsertUser({
        clerk_id: user.id,
        email: user.primaryEmailAddress?.emailAddress ?? "",
        name: user.fullName ?? user.firstName ?? user.id,
      });
    }
  }, [isSignedIn, convexUser, user, upsertUser]);

  // Loading
  if (!isLoaded || (isSignedIn && convexUser === undefined)) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950">
        <div className="animate-pulse flex flex-col items-center gap-4">
          <div className="w-12 h-12 bg-blue-600 rounded-xl" />
          <p className="text-slate-500 dark:text-slate-400 font-medium">Loading...</p>
        </div>
      </div>
    );
  }

  // Not signed in
  if (!isSignedIn) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 p-6">
        <div className="flex flex-col items-center gap-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center text-white font-bold text-xl shadow-lg shadow-blue-500/20">P</div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white">Panahon</h1>
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">LGU Command Center</p>
            </div>
          </div>
          <SignIn routing="hash" />
        </div>
      </div>
    );
  }

  // Upsert in-flight (or still undefined after sign-in guard)
  if (convexUser === null || convexUser === undefined) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950">
        <div className="animate-pulse flex flex-col items-center gap-4">
          <div className="w-12 h-12 bg-blue-600 rounded-xl" />
          <p className="text-slate-500 dark:text-slate-400 font-medium">Setting up your account...</p>
        </div>
      </div>
    );
  }

  // Wrong role — viewer sees pending access screen
  if (convexUser.role !== "admin" && convexUser.role !== "lgu") {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 p-6">
        <div className="max-w-md w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-8 text-center flex flex-col gap-4 shadow-xl">
          <div className="w-14 h-14 bg-amber-100 dark:bg-amber-900/30 text-amber-600 rounded-full flex items-center justify-center mx-auto text-3xl">⏳</div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-white">Access Pending</h2>
          <p className="text-slate-500 dark:text-slate-400 text-sm">
            Your account <b className="text-slate-700 dark:text-slate-200">{user?.primaryEmailAddress?.emailAddress}</b> has been registered but is pending LGU access.
          </p>
          <p className="text-xs text-slate-400 dark:text-slate-500 italic">
            Contact an administrator to be granted the <b>lgu</b> role.
          </p>
          <div className="p-3 bg-slate-50 dark:bg-slate-800 rounded-lg text-xs font-mono text-slate-500">
            Current role: <span className="uppercase font-bold text-amber-600">{convexUser.role}</span>
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
