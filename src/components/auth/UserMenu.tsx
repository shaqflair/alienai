"use client";

import Link from "next/link";
import { setActiveOrg } from "@/app/actions/org";
import { signOutAction } from "@/app/actions/auth";

type OrgRole = "admin" | "member";

function roleChip(role: OrgRole) {
  if (role === "admin") return { label: "Admin", cls: "bg-blue-50 border-blue-200 text-blue-900" };
  return { label: "Member", cls: "bg-gray-50 border-gray-200 text-gray-900" };
}

export default function UserMenu(props: {
  email: string;
  displayName: string;
  initials: string;
  memberships: Array<{ orgId: string; orgName: string; role: OrgRole }>;
  activeOrgId: string | null;
  activeOrgName: string | null;
  activeRole: OrgRole | null;
}) {
  const role = props.activeRole ? roleChip(props.activeRole) : null;

  return (
    <div className="relative">
      <details className="group">
        {/* ✅ Header summary: white-on-black */}
        <summary className="list-none cursor-pointer select-none">
          <div className="flex items-center gap-3 text-white">
            <div className="hidden sm:flex flex-col items-end leading-tight">
              <div className="text-sm font-medium truncate max-w-[220px] text-white">
                {props.activeOrgName ?? "No organisation"}
              </div>

              {role ? (
                <span className={`text-xs rounded border px-2 py-0.5 ${role.cls}`}>
                  {role.label}
                </span>
              ) : null}
            </div>

            <div className="h-9 w-9 rounded-full border border-neutral-700 flex items-center justify-center font-semibold text-sm text-white">
              {props.initials}
            </div>
          </div>
        </summary>

        {/* ✅ Dropdown panel: normal readable text */}
       <div className="absolute right-0 mt-2 w-[320px] rounded-xl border bg-white text-gray-900 shadow-lg p-3 z-50">
          <div className="px-2 py-2">
            <div className="text-sm font-semibold truncate text-gray-900">{props.displayName}</div>
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
                className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
                onChange={(e) => e.currentTarget.form?.requestSubmit()}
              >
                {props.memberships.length === 0 ? (
                  <option value="">No organisations</option>
                ) : (
                  props.memberships.map((m) => (
                    <option key={m.orgId} value={m.orgId}>
                      {m.orgName} ({m.role})
                    </option>
                  ))
                )}
              </select>
            </form>

            {props.memberships.length === 0 ? (
              <div className="text-xs text-gray-500">
                You’re not a member of any organisation yet.
              </div>
            ) : null}
          </div>

          <div className="my-2 h-px bg-gray-200" />

          <div className="px-2 py-2 grid gap-1">
            <Link href="/profile" className="rounded-md px-2 py-2 text-sm hover:bg-gray-50 text-gray-900">
              Profile
            </Link>
            <Link href="/settings" className="rounded-md px-2 py-2 text-sm hover:bg-gray-50 text-gray-900">
              Settings
            </Link>
            <Link href="/members" className="rounded-md px-2 py-2 text-sm hover:bg-gray-50 text-gray-900">
              Members
            </Link>
          </div>

          <div className="my-2 h-px bg-gray-200" />

          <form action={signOutAction} className="px-2 py-2">
            <button type="submit" className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm hover:bg-red-50 text-left text-gray-900">
              Log out
            </button>
          </form>
        </div>
      </details>
    </div>
  );
}
