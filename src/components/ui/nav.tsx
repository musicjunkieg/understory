import Link from "next/link";
import Image from "next/image";
import { LoginForm } from "@/components/login-form";

interface NavProps {
  minimal?: boolean;
  user?: {
    did: string;
    handle: string;
    avatar?: string;
  } | null;
}

function Nav({ minimal = false, user = null }: NavProps) {
  return (
    <nav className="fixed top-0 z-50 w-full misty-glass">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
        <Link href="/" className="font-headline text-xl italic text-on-surface">
          Understory
        </Link>

        {!minimal && (
          <div className="hidden items-center gap-8 md:flex">
            <Link
              href={user ? `/for/${user.handle}` : "/talks"}
              className="text-body-md text-on-surface-variant transition-colors hover:text-on-surface"
            >
              Feed
            </Link>
            <Link
              href={user ? `/map/${user.handle}` : "/talks"}
              className="text-body-md text-on-surface-variant transition-colors hover:text-on-surface"
            >
              Map
            </Link>
          </div>
        )}

        <div className="flex items-center gap-4">
          {user ? (
            <div className="flex items-center gap-3">
              {user.avatar && (
                <Image
                  src={user.avatar}
                  alt=""
                  width={32}
                  height={32}
                  className="h-8 w-8 rounded-full"
                  unoptimized
                />
              )}
              <span className="text-label-md text-on-surface-variant">
                @{user.handle}
              </span>
              <form action="/oauth/logout" method="POST">
                <button
                  type="submit"
                  className="text-label-sm text-outline hover:text-on-surface-variant transition-colors cursor-pointer"
                >
                  Sign out
                </button>
              </form>
            </div>
          ) : (
            <LoginForm />
          )}
        </div>
      </div>
    </nav>
  );
}

export { Nav, type NavProps };
