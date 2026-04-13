"use client";

import { useState } from "react";
import { LoginPanel } from "@/components/login-panel";

/**
 * Nav-bar dropdown wrapper around <LoginPanel>. The trigger button toggles
 * a small popover that contains the actual form. Used by the Nav component
 * for surfaces that still want a click-to-reveal login (none currently — the
 * landing page now sends users to /login instead — but the component is kept
 * for any caller that opts in via <Nav showLogin>).
 */
export function LoginForm() {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="text-label-md text-on-surface-variant hover:text-on-surface transition-colors cursor-pointer"
      >
        Sign in with your Atmosphere Account
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 z-50">
          <LoginPanel variant="dropdown" onCancel={() => setOpen(false)} />
        </div>
      )}
    </div>
  );
}
