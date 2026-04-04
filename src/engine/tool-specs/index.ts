import { createBrowserPiTool } from "./browser.js";
import { createEdgePiTools } from "./edge.js";
import { createImagePiTool } from "./image.js";
import { createJobsPiTools } from "./jobs.js";
import { createKnowledgePiTools } from "./knowledge.js";
import { createMcpPiTools } from "./mcp.js";
import { createMemoryPiTools } from "./memory.js";
import { createPlanPiTools } from "./plans.js";
import { createProjectsPiTools } from "./projects.js";
import { createSystemPiTools } from "./system.js";
import { createVideoPiTools } from "./video.js";
import { createWebPiTools } from "./web.js";
import { createWorkspacePiTools } from "./workspace.js";
import type { EngineToolingNamespaces } from "../types.js";

export {
  createBrowserPiTool,
  createEdgePiTools,
  createImagePiTool,
  createJobsPiTools,
  createKnowledgePiTools,
  createMcpPiTools,
  createMemoryPiTools,
  createPlanPiTools,
  createProjectsPiTools,
  createSystemPiTools,
  createVideoPiTools,
  createWebPiTools,
  createWorkspacePiTools,
};

export function createPiNamespaceTools(params: {
  system: Parameters<typeof createSystemPiTools>[0];
  video: Parameters<typeof createVideoPiTools>[0];
  jobs: Parameters<typeof createJobsPiTools>[0];
  knowledge: Parameters<typeof createKnowledgePiTools>[0];
  projects: Parameters<typeof createProjectsPiTools>[0];
  edge: Parameters<typeof createEdgePiTools>[0];
  mcp: Parameters<typeof createMcpPiTools>[0];
  memory: Parameters<typeof createMemoryPiTools>[0];
  workspace: Parameters<typeof createWorkspacePiTools>[0];
  web: Parameters<typeof createWebPiTools>[0];
  browser: Parameters<typeof createBrowserPiTool>[0];
  plans: Parameters<typeof createPlanPiTools>[0];
  image: Parameters<typeof createImagePiTool>[0];
}) {
  return {
    system: createSystemPiTools(params.system),
    video: createVideoPiTools(params.video),
    jobs: createJobsPiTools(params.jobs),
    knowledge: createKnowledgePiTools(params.knowledge),
    projects: createProjectsPiTools(params.projects),
    edge: createEdgePiTools(params.edge),
    mcp: createMcpPiTools(params.mcp),
    memory: createMemoryPiTools(params.memory),
    workspace: createWorkspacePiTools(params.workspace),
    web: createWebPiTools(params.web),
    browser: createBrowserPiTool(params.browser),
    plans: createPlanPiTools(params.plans),
    image: createImagePiTool(params.image),
  };
}

export type PiNamespaceTooling = EngineToolingNamespaces;
