"use client";

import { useSearchParams } from "next/navigation";
import { authClient } from "@/lib/auth-client";

export default function LoginPage() {
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") ?? "/";

  const handleSignIn = () => {
    void authClient.signIn.social({ provider: "google", callbackURL: callbackUrl });
  };

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-xl flex-col items-center justify-center gap-6 px-6 text-center">
      <div className="space-y-2">
        <h1 className="text-3xl font-semibold text-zinc-900">Sign in</h1>
        <p className="text-sm text-zinc-600">
          Use your Google Workspace account.
        </p>
      </div>
      <button
        type="button"
        onClick={handleSignIn}
        className="h-11 rounded-md bg-zinc-900 px-6 text-sm font-medium text-white"
      >
        Continue with Google
      </button>
    </main>
  );
}
