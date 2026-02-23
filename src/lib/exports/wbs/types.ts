export type WbsItemRow = Record<string, unknown>;
export type WbsNode = {
  id: string;
  parentId: string | null;
  code?: string | null;          // e.g. "1.2.3"
  name: string;                  // title / name
  description?: string | null;

  owner?: string | null;
  status?: string | null;        // e.g. "on_track"
  start?: Date | null;
  end?: Date | null;

  // Optional rollups (if you store them)
  effort_hours?: number | null;
  cost?: number | null;

  // Optional tags
  tags?: string[];
};

export type NormalizedWbs = {
  nodes: WbsNode[];
};

export type RenderWbsXlsxArgs = Record<string, unknown>;