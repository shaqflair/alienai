"use client";

export type RowObj = { type: "header" | "data"; cells: string[] };

export type Section = {
  key: string;
  title: string;
  bullets?: string;
  table?: { columns: number; rows: RowObj[] };
};

export type Patch =
  | { kind: "replace_section"; key: string; section: Section }
  | { kind: "suggestions"; key: string; suggestions: { id: string; label: string; section: Section }[] }
  | {
      kind: "validate";
      issues: {
        key: string;
        severity: "info" | "warn" | "error";
        message: string;
        fix?: { kind: "replace_section"; key: string; section: Section };
      }[];
    }
  | { kind: "replace_all"; doc: any };

async function postJson(path: string, payload: any) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(String(data?.error || "Request failed"));
  return data;
}

export async function aiSuggestClosureSection(args: {
  key: string;
  meta: any;
  currentSection: any;
  context: any;
  prompt?: string;
}): Promise<Patch> {
  const data = await postJson("/api/wireai/generate", {
    mode: "suggest",
    key: args.key,
    meta: args.meta,
    currentSection: args.currentSection,
    context: args.context,
    prompt: args.prompt || "",
  });
  return data.patch as Patch;
}

export async function aiGenerateClosureSection(args: {
  key: string;
  meta: any;
  currentSection: any;
  context: any;
  prompt?: string;
}): Promise<Patch> {
  const data = await postJson("/api/wireai/generate", {
    mode: "section",
    key: args.key,
    meta: args.meta,
    currentSection: args.currentSection,
    context: args.context,
    prompt: args.prompt || "",
  });
  return data.patch as Patch;
}
