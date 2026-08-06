import { auth, defineMcp } from "@lovable.dev/mcp-js";
import listProjectsTool from "./tools/list-projects";
import getProjectTool from "./tools/get-project";
import createProjectTool from "./tools/create-project";
import updateProjectTool from "./tools/update-project";
import deleteProjectTool from "./tools/delete-project";

const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "hydrogen-hub-config",
  title: "Hydrogen Hub Config",
  version: "0.1.0",
  instructions:
    "Tools for Hydrogen Hub Config, a hydrogen supply chain optimization configurator. List, read, create, update, and delete the signed-in user's projects and their configuration JSON.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [
    listProjectsTool,
    getProjectTool,
    createProjectTool,
    updateProjectTool,
    deleteProjectTool,
  ],
});
