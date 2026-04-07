import { useUser } from "@clerk/clerk-react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Badge, Card } from "@panahon/ui";

export function AdminGuard({ children }: { children: React.ReactNode }) {
  const { isLoaded, isSignedIn, user } = useUser();
  const convexUser = useQuery(api.users.current);

  if (!isLoaded || convexUser === undefined) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-slate-50 dark:bg-slate-900">
        <div className="animate-pulse flex flex-col items-center gap-4">
          <div className="w-12 h-12 bg-blue-600 rounded-xl"></div>
          <p className="text-slate-500 font-medium">Validating session...</p>
        </div>
      </div>
    );
  }

  if (!isSignedIn) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-slate-50 dark:bg-slate-900 p-6">
        <Card className="max-w-md w-full p-8 text-center flex flex-col gap-6">
          <div className="w-16 h-16 bg-blue-100 dark:bg-blue-900/30 text-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-2 text-2xl font-bold">
            P
          </div>
          <div>
            <h1 className="text-2xl font-bold">Access Denied</h1>
            <p className="text-slate-500 mt-2">Please sign in to access the Panahon Admin Console.</p>
          </div>
          <a
            href={import.meta.env.VITE_CLERK_SIGN_IN_URL || "#"}
            className="bg-blue-600 text-white px-6 py-3 rounded-xl font-bold hover:bg-blue-700 transition-all"
          >
            Sign In
          </a>
        </Card>
      </div>
    );
  }

  if (convexUser?.role !== "admin") {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-slate-50 dark:bg-slate-900 p-6">
        <Card className="max-w-md w-full p-8 text-center flex flex-col gap-4">
          <Badge variant="error">Unauthorized</Badge>
          <h1 className="text-2xl font-bold">Insufficient Permissions</h1>
          <p className="text-slate-500">
            Account <b>{user?.primaryEmailAddress?.emailAddress}</b> does not have administrative privileges.
          </p>
          <p className="text-xs text-slate-400 italic">
            Current Role: <span className="uppercase font-bold">{convexUser?.role || "NONE"}</span>
          </p>
        </Card>
      </div>
    );
  }

  return <>{children}</>;
}
