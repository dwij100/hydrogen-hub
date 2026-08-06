import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "update_project",
  title: "Update project",
  description: "Rename a project and/or replace its configuration JSON.",
  inputSchema: {
    project_id: z.string().uuid().describe("The project id."),
    name: z.string().trim().min(1).optional().describe("New project name."),
    config: z.record(z.any()).optional().describe("Replacement configuration JSON."),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  handler: async ({ project_id, name, config }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    if (name === undefined && config === undefined) {
      return { content: [{ type: "text", text: "Provide name and/or config to update" }], isError: true };
    }
    const supabase = supabaseForUser(ctx);
    const patch: Record<string, unknown> = {};
    if (name !== undefined) patch.name = name;
    if (config !== undefined) patch.config = config;
    const { data, error } = await supabase
      .from("projects")
      .update(patch)
      .eq("id", project_id)
      .select()
      .maybeSingle();
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    if (!data) return { content: [{ type: "text", text: "Project not found" }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify(data) }],
      structuredContent: { project: data },
    };
  },
});
