export type ChangeAttachment = { 
  name: string; 
  url: string 
};

export type ChangeExportBranding = {
  orgName?: string | null;
  clientName?: string | null;
  logoUrl?: string | null;
};

export type ChangeExportData = {
  cr: Record<string, any>;
  attachments: ChangeAttachment[];
  branding: ChangeExportBranding;
};
