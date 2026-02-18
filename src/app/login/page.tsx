// src/app/login/page.tsx
import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";

// If you already have an auth UI component, import it here.
// Change this import to your real component path if needed:
import AuthForm from "@/components/AuthForm";

type SP = { next?: string };

export default async function AuthPage({
  searchParams,
}: {
  searchParams?: SP | Promise<SP>;
}) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Next can pass searchParams as an object; keep Promise support just in case
  const sp = (searchParams && typeof (searchParams as any)?.then === "function"
    ? await (searchParams as Promise<SP>)
    : (searchParams as SP | undefined)) ?? {};

  const nextUrl = sp.next ?? "/projects";

  // If already logged in, go to destination
  if (user) {
    redirect(nextUrl);
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      {/* If your AuthForm doesn't take props, change to <AuthForm /> */}
      <AuthForm next={nextUrl} />
    </div>
  );
}
