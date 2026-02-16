import "server-only";
import ExcelJS from "exceljs";
import { sanitizeFilename } from "../_shared/utils";

export async function generateRaidXlsx(params: { doc: any; meta: any }) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("RAID Log");

  // Setup Columns
  sheet.columns = [
    { header: "ID", key: "id", width: 10 },
    { header: "Type", key: "type", width: 15 },
    { header: "Description", key: "desc", width: 50 },
    { header: "Status", key: "status", width: 15 },
    { header: "Owner", key: "owner", width: 20 },
    { header: "Next Action", key: "action", width: 30 },
  ];

  // Style the header
  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFF3F4F6" },
  };

  // Add Data
  const items = params.doc.items || params.doc.risks || [];
  items.forEach((item: any) => {
    sheet.addRow({
      id: item.display_id || item.id,
      type: item.type || "Risk",
      desc: item.description,
      status: item.status,
      owner: item.owner,
      action: item.next_action,
    });
  });

  const buffer = await workbook.xlsx.writeBuffer();
  const filename = `${sanitizeFilename(params.meta.projectCode)}_RAID_Log.xlsx`;

  return { buffer: Buffer.from(buffer), filename };
}
