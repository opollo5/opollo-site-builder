"use client";

// ---------------------------------------------------------------------------
// Spec 22 PR 2 — ApprovalToggle.
//
// Toggle: "Post needs approval". When on, the submit flow leaves the post in
// 'pending_client_approval' after submission (no auto-approve). When off, the
// flow attempts auto-approval (if the user has the permission).
// ---------------------------------------------------------------------------

interface ApprovalToggleProps {
  value: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}

export function ApprovalToggle({ value, onChange, disabled }: ApprovalToggleProps) {
  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        role="switch"
        aria-checked={value}
        disabled={disabled}
        onClick={() => onChange(!value)}
        className={[
          "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
          value ? "bg-pk" : "bg-white/20",
        ].join(" ")}
      >
        <span
          aria-hidden="true"
          className={[
            "pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-lg transition-transform",
            value ? "translate-x-4" : "translate-x-0",
          ].join(" ")}
        />
      </button>
      <div className="flex items-center gap-1.5">
        <span className="text-sm text-foreground">Post needs approval</span>
        <a
          href="/company/social/posts"
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-muted-foreground underline hover:text-foreground"
          tabIndex={disabled ? -1 : 0}
        >
          Learn more
        </a>
      </div>
    </div>
  );
}
