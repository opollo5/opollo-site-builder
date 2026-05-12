"use client";

import { ChannelPickerBody } from "@/components/ChannelPickerBody";
import { Button } from "@/components/ui/button";

// ---------------------------------------------------------------------------
// ChannelPickerModal — wraps ChannelPickerBody in a dialog shell.
//
// Used by the "Switch channel" admin action on healthy connections.
// (For the post-OAuth channel-selection flow we use the popup-mode page
// /connect/pick-channel that renders the same body fullscreen.)
// ---------------------------------------------------------------------------

type Props = {
  connectionId: string;
  platform: "LINKEDIN" | "FACEBOOK" | "INSTAGRAM" | "YOUTUBE" | "GOOGLE_BUSINESS";
  platformLabel: string;
  isOpen: boolean;
  onClose: () => void;
  onSelected: () => void;
};

export function ChannelPickerModal({
  connectionId,
  platform,
  platformLabel,
  isOpen,
  onClose,
  onSelected,
}: Props) {
  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="channel-picker-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      data-testid="channel-picker-modal"
    >
      <div className="max-h-[80vh] w-full max-w-md overflow-hidden rounded-lg bg-background shadow-xl">
        <header className="border-b p-4">
          <h2
            id="channel-picker-title"
            className="text-base font-semibold"
            data-testid="channel-picker-title"
          >
            Pick a {platformLabel} channel
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Posts to this connection will be published to the channel you
            pick. You can change it later.
          </p>
        </header>

        <div className="max-h-[55vh] overflow-y-auto p-4">
          <ChannelPickerBody
            connectionId={connectionId}
            platform={platform}
            platformLabel={platformLabel}
            onSelected={onSelected}
            autoFetch={isOpen}
          />
        </div>

        <footer className="flex justify-end gap-2 border-t p-4">
          <Button
            variant="ghost"
            onClick={onClose}
            data-testid="channel-picker-close"
          >
            Close
          </Button>
        </footer>
      </div>
    </div>
  );
}
