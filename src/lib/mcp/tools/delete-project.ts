import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "delete_project",
  title: "Delete project",
  description: "Permanently delete one of the signed-in user's projects.",
  inputSchema: { project_id: z.string().uuid().describe("The project id to delete.") },
  annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
  handler: async ({ project_id }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const supabase = supabaseForUser(ctx);
    const { data, error } = await supabase
      .from("projects")
      .delete()
      .eq("id", project_id)
      .select("id")
      .maybeSingle();
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    if (!data) return { content: [{ type: "text", text: "Project not found" }], isError: true };
    return {
      content: [{ type: "text", text: `Deleted project ${project_id}` }],
      structuredContent: { deletedId: project_id },
    };
  },
});
