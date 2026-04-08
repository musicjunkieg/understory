import Link from "next/link";
import { Nav } from "@/components/ui/nav";
import { Button } from "@/components/ui/button";
import { getAuthUser } from "@/lib/auth/user";

export default async function Home() {
  const user = await getAuthUser();

  return (
    <>
      <Nav minimal user={user} />
      <main>
        {/* Hero */}
        <section className="flex min-h-screen flex-col items-center justify-center px-6 text-center">
          <h1 className="text-display-lg text-on-surface mb-6 max-w-3xl">
            What your{" "}
            <span className="text-primary-fixed">timeline</span> missed.
          </h1>
          <p className="text-body-lg text-on-surface-variant mb-10 max-w-xl">
            Your network already surfaced the popular talks. Understory finds
            the ones they didn&apos;t.
          </p>
          <div className="flex flex-col items-center gap-4 sm:flex-row">
            <Button variant="primary" disabled>
              Get started
            </Button>
            <Link
              href="/talks"
              className="text-body-md text-primary-fixed-dim transition-colors hover:text-primary-fixed"
            >
              Browse talks →
            </Link>
          </div>
        </section>

        {/* Feature sections */}
        <section className="bg-surface-container-low py-24">
          <div className="mx-auto max-w-3xl space-y-16 px-6">
            <div>
              <h2 className="text-headline-sm text-on-surface mb-3">
                Quiet Discovery
              </h2>
              <p className="text-body-md text-on-surface-variant">
                We crawl your network&apos;s conference posts and invert the
                signal. The talks nobody mentioned? Those glow brightest.
              </p>
            </div>

            <div>
              <h2 className="text-headline-sm text-on-surface mb-3">
                Tuned to You
              </h2>
              <p className="text-body-md text-on-surface-variant">
                Your posting history meets talk transcripts. Understory finds
                talks that match your interests but slipped past your feed.
              </p>
            </div>

            <div>
              <h2 className="text-headline-sm text-on-surface mb-3">
                Friend Signal
              </h2>
              <p className="text-body-md text-on-surface-variant">
                Your friends can recommend talks directly. Human curation, not
                engagement metrics.
              </p>
            </div>
          </div>
        </section>

        {/* Footer */}
        <footer className="bg-surface-container-lowest py-8 px-6">
          <div className="mx-auto max-w-3xl flex flex-col items-center gap-2 text-center">
            <p className="text-label-md text-on-surface-variant">
              Built for the Streamplace VOD JAM
            </p>
            <div className="flex gap-4">
              <a
                href="https://atmosphereconf.org"
                target="_blank"
                rel="noopener noreferrer"
                className="text-label-sm text-outline transition-colors hover:text-on-surface-variant"
              >
                ATmosphereConf
              </a>
              <a
                href="https://github.com/musicjunkieg/understory"
                target="_blank"
                rel="noopener noreferrer"
                className="text-label-sm text-outline transition-colors hover:text-on-surface-variant"
              >
                GitHub
              </a>
            </div>
          </div>
        </footer>
      </main>
    </>
  );
}
