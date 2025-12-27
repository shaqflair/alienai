import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import AuthForm from "@/components/AuthForm";

type SP = { next?: string };

export default async function AuthPage({
  searchParams,
}: {
  searchParams?: Promise<SP> | SP;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const sp = (await searchParams) ?? {};
  const nextUrl = sp.next ?? "/projects";

  // If already logged in, go to destination
  if (user) redirect(nextUrl);

  return (
    <div className="flex min-h-screen items-center justify-center">
      <AuthForm next={nextUrl} />
    </div>
  );
}
