import { WbsRow } from "@/types/wbs";

export function exportToCSV(rows: WbsRow[], filename = "wbs-export.csv") {
  const headers = ["Code", "Level", "Deliverable", "Status", "Effort", "Owner", "Due Date"];
  const csvRows = rows.map(r => [
    r.code,
    r.level,
    "\",
    r.status,
    r.effort,
    r.owner,
    r.due_date
  ].join(","));

  const csvContent = [headers.join(","), ...csvRows].join("\n");
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  
  link.href = URL.createObjectURL(blob);
  link.setAttribute("download", filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
