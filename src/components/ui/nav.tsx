import Link from "next/link";

function Nav() {
  return (
    <nav className="fixed top-0 z-50 w-full misty-glass">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
        {/* Wordmark */}
        <Link href="/" className="font-headline text-xl italic text-on-surface">
          Understory
        </Link>

        {/* Center links */}
        <div className="hidden items-center gap-8 md:flex">
          <Link
            href="/for/me"
            className="text-body-md text-on-surface-variant transition-colors hover:text-on-surface"
          >
            Feed
          </Link>
          <Link
            href="/map/me"
            className="text-body-md text-on-surface-variant transition-colors hover:text-on-surface"
          >
            Map
          </Link>
        </div>

        {/* Right side — placeholder for auth */}
        <div className="flex items-center gap-4">
          <span className="text-label-md text-on-surface-variant">
            Sign in with your Atmosphere Account
          </span>
        </div>
      </div>
    </nav>
  );
}

export { Nav };
