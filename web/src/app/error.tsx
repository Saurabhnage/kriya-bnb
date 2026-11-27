"use client";

import { useEffect } from "react";

// Shows the error instead of a blank page if anything in the app crashes while rendering.
export default function Error({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error("KRIYA render error", error);
  }, [error]);
  return (
    <div className="card mx-auto mt-16 max-w-lg p-6 text-center">
      <p className="font-semibold">Something went wrong while showing this page.</p>
      <p className="mt-2 break-words font-mono text-xs text-danger">{error.message}</p>
      <div className="mt-4 flex justify-center gap-2">
        <button className="btn btn-primary" onClick={() => retry()}>
          Try again
        </button>
        <button className="btn" onClick={() => window.location.reload()}>
          Reload
        </button>
      </div>
    </div>
  );
}
