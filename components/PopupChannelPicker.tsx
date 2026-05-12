"use client";

import { useEffect } from "react";

import { ChannelPickerBody } from "@/components/ChannelPickerBody";
import { Button } from "@/components/ui/button";
import { SocialPlatformIcon } from "@/components/ui/SocialPlatformIcon";

// ---------------------------------------------------------------------------
// PopupChannelPicker — fullscreen popup-mode channel picker.
//
// Hosted by /connect/pick-channel. Loaded by the OAuth popup after the
// callback route redirects there. On success / cancel, fires a
// postMessage to window.opener (same envelope as the OAuth callback's
// popupCloseResponse) and self-closes.
// ---------------------------------------------------------------------------

const POPUP_MESSAGE_TYPE = "bundle-connect-complete";

type Props = {
  connectionId: string;
  platform: "LINKEDIN" | "FACEBOOK" | "INSTAGRAM" | "YOUTUBE" | "GOOGLE_BUSINESS";
  platformLabel: string;
  origin: string;
};

export function PopupChannelPicker({
  connectionId,
  platform,
  platformLabel,
  origin,
}: Props) {
  // Defensive: if the popup is loaded standalone (no opener), redirect
  // back to the connections page rather than leaving a dead popup.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!window.opener || window.opener.closed) {
      // Allow a tick for opener to be set if we're inside a popup that
      // landed via 302 from the callback route.
      const t = setTimeout(() => {
        if (!window.opener || window.opener.closed) {
          window.location.href = "/company/social/connections";
        }
      }, 200);
      return () => clearTimeout(t);
    }
  }, []);

  function postCompleteAndClose(success: boolean, reason?: string) {
    if (typeof window === "undefined") return;
    try {
      if (window.opener && !window.opener.closed) {
        window.opener.postMessage(
          {
            type: POPUP_MESSAGE_TYPE,
            connect: success ? "success" : "noop",
            ...(reason ? { reason } : {}),
            connection_id: connectionId,
          },
          origin,
        );
      }
    } catch {
      // opener may be cross-origin if we got here via an error path;
      // silently discard.
    }
    window.close();
  }

  return (
    <div
      className="flex min-h-screen flex-col bg-background"
      data-testid="popup-channel-picker"
    >
      <header className="border-b p-4">
        <div className="flex items-center gap-3">
          <SocialPlatformIcon
            platform={platform}
            size={24}
            className="text-foreground"
          />
          <h1 className="text-base font-semibold">
            Pick a {platformLabel} channel
          </h1>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Posts to this connection will be published to the channel you pick.
          You can change it later from the connections page.
        </p>
      </header>

      <main className="flex-1 overflow-y-auto p-4">
        <ChannelPickerBody
          connectionId={connectionId}
          platform={platform}
          platformLabel={platformLabel}
          autoFetch={true}
          onSelected={() => postCompleteAndClose(true)}
        />
      </main>

      <footer className="flex justify-end gap-2 border-t p-4">
        <Button
          variant="ghost"
          onClick={() => postCompleteAndClose(false, "user-cancelled")}
          data-testid="popup-picker-cancel"
        >
          Cancel
        </Button>
      </footer>
    </div>
  );
}
