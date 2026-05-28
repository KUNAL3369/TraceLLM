import { supabase } from "../db/supabase.js";
import { logger } from "../services/logger.js";

/**
 * RBAC middleware — checks user's role in the project's organization.
 * Usage: app.use("/api/some-route", rbac("admin"), handler);
 */
export function rbac(...allowedRoles) {
  return async (req, res, next) => {
    try {
      const projectId =
        req.params.projectId ||
        req.query.project_id ||
        req.body?.project_id ||
        req.projectId;
      if (!projectId) {
        return res
          .status(400)
          .json({ error: "Project ID required for RBAC check" });
      }

      const { data: project } = await supabase
        .from("projects")
        .select("organization_id")
        .eq("id", projectId)
        .single();

      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }

      const { data: membership } = await supabase
        .from("organization_members")
        .select("role")
        .eq("organization_id", project.organization_id)
        .eq("user_id", req.userId)
        .single();

      if (!membership) {
        return res
          .status(403)
          .json({ error: "Not a member of this organization" });
      }

      if (allowedRoles.length > 0 && !allowedRoles.includes(membership.role)) {
        return res.status(403).json({
          error: `Requires one of roles: ${allowedRoles.join(", ")}`,
          your_role: membership.role,
        });
      }

      req.organizationId = project.organization_id;
      req.userRole = membership.role;
      next();
    } catch (err) {
      next(err);
    }
  };
}

/**
 * Check if user has a specific permission.
 */
export async function hasPermission(userId, projectId, permission) {
  try {
    const { data: project } = await supabase
      .from("projects")
      .select("organization_id")
      .eq("id", projectId)
      .single();
    if (!project) return false;

    const { data: membership } = await supabase
      .from("organization_members")
      .select("role")
      .eq("organization_id", project.organization_id)
      .eq("user_id", userId)
      .single();
    if (!membership) return false;

    const { data: perm } = await supabase
      .from("role_permissions")
      .select("id")
      .eq("role", membership.role)
      .eq("permission", permission)
      .single();

    return !!perm;
  } catch {
    logger.warn("RBAC permission check failed");
    return false;
  }
}
