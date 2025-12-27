import Link from "next/link";
import { createClient } from "@/utils/supabase/server";
import { signOutAction } from "@/app/actions/auth";

export default async function AuthButton() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <Link
        href="/login"
        className="rounded-md border px-3 py-1 text-sm hover:bg-gray-100"
      >
        Log in
      </Link>
    );
  }

  const email = user.email ?? "Account";

  return (
    <div className="flex items-center gap-3">
      {/* User email */}
      <span className="text-sm text-gray-600 truncate max-w-[220px]">
        {email}
      </span>

      {/* Logout */}
      <form action={signOutAction}>
        <button
          type="submit"
          className="rounded-md border px-3 py-1 text-sm hover:bg-red-50"
        >
          Log out
        </button>
      </form>
    </div>
  );
}
