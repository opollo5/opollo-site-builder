"use client";

import { useState } from "react";

// ---------------------------------------------------------------------------
// ReconnectButton — B4 client portal
//
// Opens the OAuth reconnect popup for a specific connection.
// The portal token is passed so the server-side API can validate the
// magic_links session (Step 5 implements POST /api/portal/connections/[id]/reconnect).
//
// Current state (Step 4): button is rendered; API route built in Step 5.
// ---------------------------------------------------------------------------

type Props = {
  connectionId: string;
  token: string;       // raw magic-link token — passed to API for session validation
  platform: string;
};

export function ReconnectButton({ connectionId, token, platform }: Props) {
  const [state, setState] = useState<"idle" | "opening" | "success" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function handleReconnect() {
    setState("opening");
    setErrorMsg(null);

    try {
      // POST to the portal-specific reconnect route (built in Step 5).
      // Passes the magic-link token for server-side session validation —
      // the server derives company_id from the token, never from this request body.
      const res = await fetch(`/api/portal/connections/${connectionId}/reconnect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });

      if (!res.ok) {
        const { error } = await res.json().catch(() => ({ error: { message: "Network error" } }));
        setErrorMsg(error?.message ?? "Failed to start reconnect.");
        setState("error");
        return;
      }

      const { data } = await res.json();
      const { url } = data;

      // Open OAuth popup (same mechanism as operator reconnect)
      const popup = window.open(url, "reconnect-popup", "width=600,height=700,scrollbars=yes");

      // Listen for postMessage from callback (bundle-connect-complete)
      const onMessage = (event: MessageEvent) => {
        if (event.data?.type !== "bundle-connect-complete") return;
        window.removeEventListener("message", onMessage);
        popup?.close();

        if (event.data.connect === "success") {
          setState("success");
          // Refresh the page to show updated connection status
          window.location.reload();
        } else {
          setErrorMsg(event.data.reason ?? "Reconnect was not completed.");
          setState("error");
        }
      };
      window.addEventListener("message", onMessage);

    } catch {
      setErrorMsg("Network error. Please try again.");
      setState("error");
    }
  }

  if (state === "success") {
    return (
      <span className="text-xs font-medium text-green-700">
        Connected ✓
      </span>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={handleReconnect}
        disabled={state === "opening"}
        className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
      >
        {state === "opening" ? "Opening…" : `Reconnect ${platform.replace(/_/g, " ")}`}
      </button>
      {errorMsg && (
        <p className="text-xs text-destructive max-w-[160px] text-right">{errorMsg}</p>
      )}
    </div>
  );
}
