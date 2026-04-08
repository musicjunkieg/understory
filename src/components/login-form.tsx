"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

export function LoginForm() {
  const [handle, setHandle] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!handle.trim()) return;

    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/oauth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ handle: handle.trim() }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Authentication failed");
        setLoading(false);
        return;
      }

      window.location.href = data.redirect;
    } catch {
      setError("Failed to connect. Please try again.");
      setLoading(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="text-label-md text-on-surface-variant hover:text-on-surface transition-colors cursor-pointer"
      >
        Sign in with your Atmosphere Account
      </button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex items-center gap-2">
      <input
        type="text"
        value={handle}
        onChange={(e) => setHandle(e.target.value)}
        placeholder="handle.bsky.social"
        aria-label="Your Atmosphere handle"
        className="rounded-lg bg-surface-container-highest px-3 py-1.5 text-body-md text-on-surface placeholder:text-on-surface-variant/50 focus:outline-none focus:ring-2 focus:ring-primary-fixed w-48"
        autoFocus
        disabled={loading}
      />
      <Button variant="primary" type="submit" loading={loading}>
        Sign in
      </Button>
      <button
        type="button"
        onClick={() => {
          setOpen(false);
          setError(null);
        }}
        className="text-label-sm text-on-surface-variant hover:text-on-surface cursor-pointer"
      >
        Cancel
      </button>
      {error && <span className="text-label-sm text-error">{error}</span>}
    </form>
  );
}
