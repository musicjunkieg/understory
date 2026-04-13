import { redirect } from "next/navigation";
import { Nav } from "@/components/ui/nav";
import { LoginPanel } from "@/components/login-panel";
import { getAuthUser } from "@/lib/auth/user";

export const metadata = {
  title: "Sign in — Understory",
  description:
    "Sign in with your Atmosphere account to see what your network missed at ATmosphereConf 2026.",
};

export default async function LoginPage() {
  // If they're already logged in, send them straight to the talks experience.
  const user = await getAuthUser();
  if (user) redirect("/talks");

  return (
    <>
      <Nav minimal user={null} />
      <main className="flex min-h-screen flex-col items-center justify-center px-6">
        <div className="w-full max-w-md">
          <h1 className="text-display-md text-on-surface mb-3 text-center">
            Sign in
          </h1>
          <p className="text-body-md text-on-surface-variant mb-8 text-center">
            Use your Atmosphere account to see the talks your network missed.
          </p>
          <LoginPanel variant="featured" />
        </div>
      </main>
    </>
  );
}
