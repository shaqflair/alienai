import { createClient } from "@/utils/supabase/server";

export default async function PrintRaid({ params }: { params: { projectId: string } }) {
  const supabase = await createClient();

  const { data: items } = await supabase
    .from("raid_items")
    .select("*")
    .eq("project_id", params.projectId)
    .order("updated_at", { ascending: false });

  return (
    <html>
      <head>
        <style>{`
          body { font-family: Inter, system-ui; padding:40px }
          h1 { font-size:22px }
          table { width:100%; border-collapse:collapse }
          th, td { border-bottom:1px solid #ddd; padding:8px; font-size:12px }
          th { text-align:left; background:#f5f5f5 }
        `}</style>
      </head>
      <body>
        <h1>Weekly RAID Export</h1>

        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Type</th>
              <th>Status</th>
              <th>Priority</th>
              <th>Owner</th>
              <th>Description</th>
            </tr>
          </thead>
          <tbody>
            {items?.map((i) => (
              <tr key={i.id}>
                <td>{i.public_id || i.id.slice(0, 8)}</td>
                <td>{i.type}</td>
                <td>{i.status}</td>
                <td>{i.priority}</td>
                <td>{i.owner_label}</td>
                <td>{i.description}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </body>
    </html>
  );
}
