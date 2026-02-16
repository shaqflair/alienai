import { createClient } from "@/utils/supabase/server";

export default async function LessonsExport({ params }: { params: { id: string } }) {
  const sb = await createClient();
  const { data: items } = await sb
    .from("lessons_learned")
    .select("*")
    .eq("project_id", params.id)
    .order("created_at", { ascending: false });

  return (
    <html>
      <head>
        <style>{`
          body { font-family: Arial, sans-serif; padding: 24px; }
          h1 { font-size: 18px; margin: 0 0 12px; }
          table { width:100%; border-collapse: collapse; font-size: 12px; }
          th, td { border: 1px solid #ddd; padding: 8px; vertical-align: top; }
          th { background: #f6f6f6; text-align:left; }
          .tag { display:inline-block; padding:2px 8px; border-radius:999px; background:#eef2f7; }
        `}</style>
      </head>
      <body>
        <h1>Lessons Learned</h1>
        <table>
          <thead>
            <tr>
              <th>Status</th>
              <th>Date</th>
              <th>Category</th>
              <th>Description</th>
              <th>Action for future</th>
            </tr>
          </thead>
          <tbody>
            {(items ?? []).map((l: any) => (
              <tr key={l.id}>
                <td>{l.status || "Open"}</td>
                <td>{String(l.created_at || "").slice(0, 10)}</td>
                <td><span className="tag">{l.category}</span></td>
                <td>{l.description}</td>
                <td>{l.action_for_future || ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </body>
    </html>
  );
}
