import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { LumeCard } from "@/components/ui/lume-card";
import { Nav } from "@/components/ui/nav";

export default function Home() {
  return (
    <>
      <Nav />
      <main className="mx-auto max-w-5xl px-6 pt-24 pb-16">
        {/* Hero */}
        <section className="mb-16">
          <p className="text-label-md text-primary-fixed-dim mb-4">
            Design System Preview
          </p>
          <h1 className="text-display-lg text-on-surface mb-6">
            What your <em className="text-primary-fixed">timeline</em> missed.
          </h1>
          <p className="text-body-lg text-on-surface-variant max-w-2xl">
            Understory inverts the signal. The talks your network missed glow
            brightest.
          </p>
        </section>

        {/* Buttons */}
        <section className="mb-16">
          <h2 className="text-headline-md text-on-surface mb-6">Buttons</h2>
          <div className="flex flex-wrap items-center gap-4">
            <Button variant="primary">Primary Action</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="tertiary">Tertiary Link</Button>
            <Button variant="primary" disabled>
              Disabled
            </Button>
            <Button variant="primary" loading>
              Loading
            </Button>
          </div>
        </section>

        {/* Chips */}
        <section className="mb-16">
          <h2 className="text-headline-md text-on-surface mb-6">
            Chips & Tags
          </h2>
          <div className="flex flex-wrap gap-3">
            <Chip>Performance Theatre</Chip>
            <Chip>lightning-talk</Chip>
            <Chip>decentralized-identity</Chip>
            <Chip variant="friend">@alice recommended</Chip>
            <Chip variant="friend">@bob recommended</Chip>
          </div>
        </section>

        {/* Lume Cards */}
        <section className="mb-16">
          <h2 className="text-headline-md text-on-surface mb-6">Lume Cards</h2>
          <div className="grid gap-6 md:grid-cols-3">
            <LumeCard glowIntensity={0.9} tileIndex={0} interestMatch>
              <div className="p-5">
                <p className="text-label-md text-primary-fixed-dim mb-2">
                  Performance Theatre &middot; 10 min
                </p>
                <h3 className="text-headline-sm text-on-surface mb-2">
                  Modular Open Science with ATProto
                </h3>
                <p className="text-body-md text-on-surface-variant">
                  95% undiscovered by your network
                </p>
              </div>
            </LumeCard>

            <LumeCard glowIntensity={0.5} tileIndex={1}>
              <div className="p-5">
                <p className="text-label-md text-primary-fixed-dim mb-2">
                  Bukhman Lounge &middot; 25 min
                </p>
                <h3 className="text-headline-sm text-on-surface mb-2">
                  Decentralized Preprints on ATProto
                </h3>
                <p className="text-body-md text-on-surface-variant">
                  50% covered by your network
                </p>
              </div>
            </LumeCard>

            <LumeCard glowIntensity={0.1} tileIndex={2}>
              <div className="p-5">
                <p className="text-label-md text-on-surface-variant mb-2">
                  Performance Theatre &middot; 45 min
                </p>
                <h3 className="text-headline-sm text-on-surface mb-2">
                  Protocol Governance in the Atmosphere
                </h3>
                <p className="text-body-md text-on-surface-variant">
                  Heavily covered — 3 friends posted about this
                </p>
              </div>
            </LumeCard>
          </div>
        </section>

        {/* Surface Tonal Scale */}
        <section className="mb-16">
          <h2 className="text-headline-md text-on-surface mb-6">
            Surface Scale
          </h2>
          <div className="grid gap-4 md:grid-cols-4">
            <div className="rounded-lg bg-surface-container-lowest p-6">
              <p className="text-label-sm text-on-surface-variant">Lowest</p>
            </div>
            <div className="rounded-lg bg-surface-container-low p-6">
              <p className="text-label-sm text-on-surface-variant">Low</p>
            </div>
            <div className="rounded-lg bg-surface-container-high p-6">
              <p className="text-label-sm text-on-surface-variant">High</p>
            </div>
            <div className="rounded-lg bg-surface-container-highest p-6">
              <p className="text-label-sm text-on-surface-variant">Highest</p>
            </div>
          </div>
        </section>

        {/* Typography */}
        <section className="mb-16">
          <h2 className="text-headline-md text-on-surface mb-6">Type Scale</h2>
          <div className="space-y-4">
            <p className="text-display-lg text-on-surface">
              display-lg — Newsreader 3.5rem
            </p>
            <p className="text-headline-md text-on-surface">
              headline-md — Newsreader 1.75rem
            </p>
            <p className="text-headline-sm text-on-surface">
              headline-sm — Newsreader 1.25rem
            </p>
            <p className="text-body-lg text-on-surface-variant">
              body-lg — Work Sans 1.125rem
            </p>
            <p className="text-body-md text-on-surface-variant">
              body-md — Work Sans 1rem
            </p>
            <p className="text-label-md text-on-surface-variant">
              label-md — Space Grotesk 0.875rem
            </p>
            <p className="text-label-sm text-on-surface-variant">
              label-sm — Space Grotesk 0.75rem
            </p>
          </div>
        </section>

        {/* Glow Spectrum */}
        <section className="mb-16">
          <h2 className="text-headline-md text-on-surface mb-6">
            Glow Spectrum
          </h2>
          <div className="grid gap-4 md:grid-cols-4">
            <div className="rounded-lg bg-glow-bright p-6">
              <p className="text-label-sm text-on-primary">Bright</p>
            </div>
            <div className="rounded-lg bg-glow-medium p-6">
              <p className="text-label-sm text-on-primary">Medium</p>
            </div>
            <div className="rounded-lg bg-glow-dim p-6">
              <p className="text-label-sm text-on-surface">Dim</p>
            </div>
            <div className="rounded-lg bg-covered-muted p-6">
              <p className="text-label-sm text-on-surface-variant">Covered</p>
            </div>
          </div>
        </section>
      </main>
    </>
  );
}
