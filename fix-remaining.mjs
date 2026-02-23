import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

const root = "D:/dev/alienai";

function fix(rel, fn) {
  const p = join(root, rel);
  try {
    const before = readFileSync(p, "utf8");
    const after = fn(before);
    if (after !== before) {
      writeFileSync(p, after, "utf8");
      console.log("  FIXED:", rel);
    } else {
      console.log("  -- (no match):", rel);
    }
  } catch (e) {
    console.log("  ERR:", rel, e.message);
  }
}

fix("src/app/api/artifacts/stakeholder-register/export/[format]/route.ts", s =>
  s
    .replace("new NextResponse(pdf, {", "new NextResponse(pdf as unknown as BodyInit, {")
    .replace("new NextResponse(xlsx, {", "new NextResponse(xlsx as unknown as BodyInit, {")
    .replace("new NextResponse(docx, {", "new NextResponse(docx as unknown as BodyInit, {")
);

fix("src/app/api/export/change/[id]/docx/route.ts", s =>
  s.replace("new NextResponse(buffer, {", "new NextResponse(buffer as unknown as BodyInit, {")
);

fix("src/app/api/export/change/[id]/pdf/route.ts", s =>
  s.replace("new NextResponse(buffer, {", "new NextResponse(buffer as unknown as BodyInit, {")
);

fix("src/app/api/lessons/[id]/route.ts", s =>
  s.replace("error.message as const", "error.message")
);

fix("src/app/api/wbs/[artifactId]/sync/route.ts", s =>
  s.replace("upsertPayload.map((x) =>", "upsertPayload.map((x: any) =>")
);

fix("src/app/projects/[id]/artifacts/[artifactId]/export/pptx/route.ts", s =>
  s
    .replace('pptx.write("nodebuffer")', 'pptx.write({ outputType: "nodebuffer" })')
    .replace("approverList.map((a) => a.user_id)", "approverList.map((a: any) => a.user_id)")
    .replace("approverList.map((a) => {", "approverList.map((a: any) => {")
);

fix("src/app/projects/[id]/artifacts/new/page.tsx", s =>
  s.replace("action={createArtifact}", 'action={async (fd) => { await createArtifact(fd); }}')
);

fix("src/app/projects/[id]/logo/upload/route.ts", s =>
  s.replace("safeParam(params?.id)", "safeParam((await params)?.id)")
);

for (const f of [
  "src/app/projects/[id]/members/page.tsx",
  "src/app/projects/[id]/members/invite/page.tsx",
]) {
  fix(f, s => s.split("\n").filter(l => !l.includes("meUserId={")).join("\n"));
}

fix("src/lib/charter/migrate-to-v2.ts", s =>
  s.replace(
    "out.sections = (out.sections ?? []).map((sec: any) => ({",
    "(out as any).sections = (out.sections ?? []).map((sec: any) => ({"
  )
);

console.log("\nDone.");
