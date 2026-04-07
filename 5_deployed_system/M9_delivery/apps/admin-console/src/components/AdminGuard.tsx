import { useEffect } from "react";
import { SignIn, useUser } from "@clerk/clerk-react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { Badge, Card } from "@panahon/ui";

export function AdminGuard({ children }: { children: React.ReactNode }) {
  const { isLoaded, isSignedIn, user } = useUser();
  const convexUser = useQuery(api.users.current);
  const upsertUser = useMutation(api.users.upsertUser);

  // Sync Clerk → Convex on first sign-in (null = not found in DB yet)
  useEffect(() => {
    if (isSignedIn && convexUser === null && user) {
      upsertUser({
        clerk_id: user.id,
        email: user.primaryEmailAddress?.emailAddress ?? "",
        name: user.fullName ?? user.firstName ?? user.id,
      });
    }
  }, [isSignedIn, convexUser, user, upsertUser]);

  // Loading: Clerk resolving OR Convex query in-flight
  if (!isLoaded || (isSignedIn && convexUser === undefined)) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-slate-50 dark:bg-slate-900">
        <div className="animate-pulse flex flex-col items-center gap-4">
          <div className="w-12 h-12 bg-blue-600 rounded-xl" />
          <p className="text-slate-500 font-medium">Validating session...</p>
        </div>
      </div>
    );
  }

  // Not signed in → Clerk's pre-built SignIn
  if (!isSignedIn) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-slate-50 dark:bg-slate-900 p-6">
        <div className="flex flex-col items-center gap-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center text-white font-bold text-xl shadow-lg shadow-blue-500/20">P</div>
            <div>
              <h1 className="text-xl font-bold tracking-tight">Panahon</h1>
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Admin Console</p>
            </div>
          </div>
          <SignIn routing="hash" />
        </div>
      </div>
    );
  }

  // Signed in but upsert still in-flight (convexUser still null after sign-in)
  if (convexUser === null || convexUser === undefined) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-slate-50 dark:bg-slate-900">
        <div className="animate-pulse flex flex-col items-center gap-4">
          <div className="w-12 h-12 bg-blue-600 rounded-xl" />
          <p className="text-slate-500 font-medium">Setting up your account...</p>
        </div>
      </div>
    );
  }

  // Not admin
  if (convexUser.role !== "admin") {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-slate-50 dark:bg-slate-900 p-6">
        <Card className="max-w-md w-full p-8 text-center flex flex-col gap-4">
          <Badge variant="error">Unauthorized</Badge>
          <h1 className="text-2xl font-bold">Insufficient Permissions</h1>
          <p className="text-slate-500">
            Account <b>{user?.primaryEmailAddress?.emailAddress}</b> does not have administrative privileges.
          </p>
          <p className="text-xs text-slate-400 italic">
            Current Role: <span className="uppercase font-bold">{convexUser.role}</span>
          </p>
        </Card>
      </div>
    );
  }

  return <>{children}</>;
}
