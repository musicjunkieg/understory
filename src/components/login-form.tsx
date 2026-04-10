"use client";

import { useState, useRef, useCallback } from "react";
import Image from "next/image";
import { Button } from "@/components/ui/button";

interface TypeaheadActor {
  handle: string;
  displayName?: string;
  avatar?: string;
}

const TYPEAHEAD_URL =
  "https://typeahead.waow.tech/xrpc/app.bsky.actor.searchActorsTypeahead";
const DEBOUNCE_MS = 200;
const MIN_QUERY_LENGTH = 2;

export function LoginForm() {
  const [handle, setHandle] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<TypeaheadActor[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchSuggestions = useCallback((query: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (query.trim().length < MIN_QUERY_LENGTH) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      try {
        const url = `${TYPEAHEAD_URL}?q=${encodeURIComponent(query.trim())}&limit=6`;
        const res = await fetch(url);
        if (!res.ok) return;
        const data = await res.json();
        setSuggestions(data.actors ?? []);
        setShowSuggestions(true);
      } catch {
        // Typeahead failure is non-fatal — user can still type manually
      }
    }, DEBOUNCE_MS);
  }, []);

  function handleInputChange(value: string) {
    setHandle(value);
    fetchSuggestions(value);
  }

  function selectSuggestion(actor: TypeaheadActor) {
    setHandle(actor.handle);
    setSuggestions([]);
    setShowSuggestions(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!handle.trim()) return;

    setLoading(true);
    setError(null);
    setShowSuggestions(false);

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

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="text-label-md text-on-surface-variant hover:text-on-surface transition-colors cursor-pointer"
      >
        Sign in with your Atmosphere Account
      </button>

      {open && (
        <form
          onSubmit={handleSubmit}
          className="absolute right-0 top-full mt-2 flex flex-col gap-3 rounded-lg bg-surface-container-high p-4 shadow-lg min-w-72 z-50"
        >
          <div className="relative">
            <input
              type="text"
              value={handle}
              onChange={(e) => handleInputChange(e.target.value)}
              onFocus={() => {
                if (suggestions.length > 0) setShowSuggestions(true);
              }}
              placeholder="handle.bsky.social"
              aria-label="Your Atmosphere handle"
              className="w-full rounded-lg bg-surface-container-highest px-3 py-2 text-body-md text-on-surface placeholder:text-on-surface-variant/50 focus:outline-none focus:ring-2 focus:ring-primary-fixed"
              autoFocus
              disabled={loading}
              autoComplete="off"
            />
            {showSuggestions && suggestions.length > 0 && (
              <ul className="absolute left-0 right-0 top-full mt-1 max-h-64 overflow-y-auto rounded-lg bg-surface-container-highest shadow-lg z-50">
                {suggestions.map((actor) => (
                  <li key={actor.handle}>
                    <button
                      type="button"
                      onClick={() => selectSuggestion(actor)}
                      className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-surface-container-high transition-colors cursor-pointer"
                    >
                      {actor.avatar ? (
                        <Image
                          src={actor.avatar}
                          alt=""
                          width={24}
                          height={24}
                          className="h-6 w-6 rounded-full flex-shrink-0"
                          unoptimized
                        />
                      ) : (
                        <div className="h-6 w-6 rounded-full bg-surface-container flex-shrink-0" />
                      )}
                      <div className="min-w-0 flex-1">
                        {actor.displayName && (
                          <div className="text-label-sm text-on-surface truncate">
                            {actor.displayName}
                          </div>
                        )}
                        <div className="text-label-sm text-on-surface-variant truncate">
                          @{actor.handle}
                        </div>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {error && (
            <span className="text-label-sm text-error">{error}</span>
          )}
          <div className="flex items-center gap-2">
            <Button variant="primary" type="submit" loading={loading}>
              Sign in
            </Button>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setError(null);
                setSuggestions([]);
                setShowSuggestions(false);
              }}
              className="text-label-sm text-on-surface-variant hover:text-on-surface cursor-pointer"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
