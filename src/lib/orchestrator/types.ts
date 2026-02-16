export type OrchestratorContext = {
  projectId: string;
  artifactId: string;
  artifactType: string;
  artifactJson: any;
  meta?: Record<string, any>;
};

export type OrchestratorResult = {
  ok: boolean;
  messages: string[];
  data?: any;
};

export type OrchestratorStep = {
  key: string;
  run: (ctx: OrchestratorContext) => Promise<OrchestratorResult>;
};

