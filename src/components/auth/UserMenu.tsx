"use client";

import Link from "next/link";
import { setActiveOrg } from "@/app/actions/org";
import { signOutAction } from "@/app/actions/auth";

type Role = "owner" | "editor" | "viewer";

function roleChip(role: Role) {
  if (role === "owner") return { label: "Owner", cls: "bg-gray-50 border-gray-200" };
  if (role === "editor") return { label: "Editor", cls: "bg-blue-50 border-blue-200" };
  return { label: "Viewer", cls: "bg-yellow-50 border-yellow-200" };
}

export default function UserMenu(props: {
  email: string;
  displayName: string;
  initials: string;
  memberships: Array<{ orgId: string; orgName: string; role: Role }>;
  activeOrgId: string | null;
  activeOrgName: string | null;
  activeRole: Role | null;
}) {
  const role = props.activeRole ? roleChip(props.activeRole) : null;

  return (
    <div className="relative">
      <details className="group">
        <summary className="list-none cursor-pointer select-none">
          <div className="flex items-center gap-3">
            <div className="hidden sm:flex flex-col items-end leading-tight">
              <div className="text-sm font-medium truncate max-w-[220px]">
                {props.activeOrgName ?? "No organisation"}
              </div>
              {role ? (
                <span className={`text-xs rounded border px-2 py-0.5 ${role.cls}`}>
                  {role.label}
                </span>
              ) : null}
            </div>

            <div className="h-9 w-9 rounded-full border flex items-center justify-center font-semibold text-sm">
              {props.initials}
            </div>
          </div>
        </summary>

        <div className="absolute right-0 mt-2 w-[320px] rounded-xl border bg-white shadow-lg p-3 z-50">
          <div className="px-2 py-2">
            <div className="text-sm font-semibold truncate">{props.displayName}</div>
            <div className="text-xs text-gray-600 truncate">{props.email}</div>
          </div>

          <div className="my-2 h-px bg-gray-200" />

          <div className="px-2 py-2 space-y-2">
            <div className="text-xs font-medium text-gray-600">Organisation</div>

            <form action={setActiveOrg}>
              <input type="hidden" name="nextPath" value="/projects" />
              <select
                name="orgId"
                defaultValue={props.activeOrgId ?? ""}
                className="w-full rounded-md border px-3 py-2 text-sm"
                onChange={(e) => e.currentTarget.form?.requestSubmit()}
              >
                {props.memberships.map((m) => (
                  <option key={m.orgId} value={m.orgId}>
                    {m.orgName} ({m.role})
                  </option>
                ))}
              </select>
            </form>
          </div>

          <div className="my-2 h-px bg-gray-200" />

          <div className="px-2 py-2 grid gap-1">
            <Link href="/profile" className="rounded-md px-2 py-2 text-sm hover:bg-gray-50">
              Profile
            </Link>
            <Link href="/settings" className="rounded-md px-2 py-2 text-sm hover:bg-gray-50">
              Settings
            </Link>
          </div>

          <div className="my-2 h-px bg-gray-200" />

          <form action={signOutAction} className="px-2 py-2">
            <button
              type="submit"
              className="w-full rounded-md border px-3 py-2 text-sm hover:bg-red-50 text-left"
            >
              Log out
            </button>
          </form>
        </div>
      </details>
    </div>
  );
}
