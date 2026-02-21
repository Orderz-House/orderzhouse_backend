import pool from "../models/db.js";

/**
 * GET /analytics/kpis
 * Read-only KPIs: freelancers, clients, projects, totalPaid.
 * Uses same auth as dashboard (authentication + adminOnly).
 * Each metric is fetched independently; one failure returns 0 for that metric.
 */
export async function getAnalyticsKpis(req, res) {
  let freelancers = 0;
  let clients = 0;
  let projects = 0;
  let totalPaid = 0;

  try {
    const [freelancersRes, clientsRes, projectsRes, totalPaidRes] = await Promise.allSettled([
      pool.query(
        "SELECT COUNT(*) AS total FROM users WHERE role_id = 3 AND (is_deleted = false OR is_deleted IS NULL)"
      ),
      pool.query(
        "SELECT COUNT(*) AS total FROM users WHERE role_id = 2 AND (is_deleted = false OR is_deleted IS NULL)"
      ),
      pool.query(
        "SELECT COUNT(*) AS total FROM projects WHERE is_deleted = false OR is_deleted IS NULL"
      ),
      pool.query(
        "SELECT COALESCE(SUM(amount), 0) AS total FROM payments WHERE status = 'paid'"
      ),
    ]);

    if (freelancersRes.status === "fulfilled" && freelancersRes.value?.rows?.[0]) {
      freelancers = Number(freelancersRes.value.rows[0].total ?? 0);
    }
    if (clientsRes.status === "fulfilled" && clientsRes.value?.rows?.[0]) {
      clients = Number(clientsRes.value.rows[0].total ?? 0);
    }
    if (projectsRes.status === "fulfilled" && projectsRes.value?.rows?.[0]) {
      projects = Number(projectsRes.value.rows[0].total ?? 0);
    }
    if (totalPaidRes.status === "fulfilled" && totalPaidRes.value?.rows?.[0]) {
      totalPaid = Number(totalPaidRes.value.rows[0].total ?? 0);
    }

    return res.status(200).json({
      success: true,
      freelancers,
      clients,
      projects,
      totalPaid,
      currency: "JD",
    });
  } catch (err) {
    console.error("getAnalyticsKpis:", err);
    return res.status(500).json({ success: false, message: "Failed to load KPIs", error: err.message });
  }
}

/**
 * Parse range query: 7d | 30d | 90d -> days number
 */
function parseRange(range) {
  const s = String(range || "30d").toLowerCase();
  const m = s.match(/^(\d+)(d|days?)$/);
  const days = m ? Math.min(365, Math.max(1, parseInt(m[1], 10))) : 30;
  return days;
}

/**
 * GET /analytics/admin?range=7d|30d|90d
 * Single overview for admin dashboard analytics page.
 */
export async function getAnalyticsAdmin(req, res) {
  try {
    const range = parseRange(req.query.range);
    const since = new Date();
    since.setDate(since.getDate() - range);
    const sinceStr = since.toISOString().slice(0, 10);

    const [
      projectsCountRes,
      projectsByDayRes,
      projectsByStatusRes,
      projectsByTypeRes,
      paymentsTotalRes,
      paymentsByDayRes,
      usersByRoleRes,
      usersByCountryRes,
      escrowSummaryRes,
      topProjectsRes,
      topCategoriesRes,
    ] = await Promise.allSettled([
      pool.query(
        "SELECT COUNT(*) AS total FROM projects WHERE is_deleted = false AND created_at >= $1",
        [sinceStr]
      ),
      pool.query(
        `SELECT date_trunc('day', created_at)::date AS day, COUNT(*) AS count
         FROM projects WHERE is_deleted = false AND created_at >= $1
         GROUP BY 1 ORDER BY 1`,
        [sinceStr]
      ),
      pool.query(
        `SELECT COALESCE(status, 'unknown') AS status, COUNT(*) AS count
         FROM projects WHERE is_deleted = false AND created_at >= $1
         GROUP BY status`,
        [sinceStr]
      ),
      pool.query(
        `SELECT COALESCE(project_type, 'fixed') AS project_type, COUNT(*) AS count
         FROM projects WHERE is_deleted = false AND created_at >= $1
         GROUP BY project_type`,
        [sinceStr]
      ),
      pool.query(
        `SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS count
         FROM payments WHERE status = 'paid' AND created_at >= $1`,
        [sinceStr]
      ),
      pool.query(
        `SELECT date_trunc('day', created_at)::date AS day, COALESCE(SUM(amount), 0) AS total
         FROM payments WHERE status = 'paid' AND created_at >= $1
         GROUP BY 1 ORDER BY 1`,
        [sinceStr]
      ),
      pool.query(
        `SELECT role_id, COUNT(*) AS count FROM users WHERE is_deleted = false GROUP BY role_id`
      ),
      pool.query(
        `SELECT COALESCE(country, 'Unknown') AS country, COUNT(*) AS count
         FROM users WHERE is_deleted = false AND country IS NOT NULL AND country != ''
         GROUP BY country ORDER BY count DESC LIMIT 15`
      ),
      pool.query(
        `SELECT status, COALESCE(SUM(amount), 0) AS total, COUNT(*) AS count
         FROM escrow GROUP BY status`
      ),
      pool.query(
        `SELECT p.id, p.title, p.created_at, p.status,
                (SELECT COUNT(*) FROM project_assignments pa WHERE pa.project_id = p.id) AS applications
         FROM projects p
         WHERE p.is_deleted = false AND p.created_at >= $1
         ORDER BY p.created_at DESC
         LIMIT 10`,
        [sinceStr]
      ),
      pool.query(
        `SELECT c.name AS category_name, COUNT(p.id) AS projects_count
         FROM categories c
         LEFT JOIN projects p ON p.category_id = c.id AND p.is_deleted = false AND p.created_at >= $1
         WHERE c.is_deleted = false
         GROUP BY c.id, c.name
         HAVING COUNT(p.id) > 0
         ORDER BY projects_count DESC
         LIMIT 10`,
        [sinceStr]
      ),
    ]);

    const projectsCount = projectsCountRes.status === "fulfilled" ? Number(projectsCountRes.value?.rows?.[0]?.total || 0) : 0;
    const projectsByDay = projectsByDayRes.status === "fulfilled" ? projectsByDayRes.value?.rows || [] : [];
    const projectsByStatus = projectsByStatusRes.status === "fulfilled" ? projectsByStatusRes.value?.rows || [] : [];
    const projectsByType = projectsByTypeRes.status === "fulfilled" ? projectsByTypeRes.value?.rows || [] : [];
    const paymentsTotal = paymentsTotalRes.status === "fulfilled" ? Number(paymentsTotalRes.value?.rows?.[0]?.total || 0) : 0;
    const paymentsCount = paymentsTotalRes.status === "fulfilled" ? Number(paymentsTotalRes.value?.rows?.[0]?.count || 0) : 0;
    const paymentsByDay = paymentsByDayRes.status === "fulfilled" ? paymentsByDayRes.value?.rows || [] : [];
    const usersByRole = usersByRoleRes.status === "fulfilled" ? usersByRoleRes.value?.rows || [] : [];
    const usersByCountry = usersByCountryRes.status === "fulfilled" ? usersByCountryRes.value?.rows || [] : [];
    const escrowSummary = escrowSummaryRes.status === "fulfilled" ? escrowSummaryRes.value?.rows || [] : [];
    const topProjects = topProjectsRes.status === "fulfilled" ? topProjectsRes.value?.rows || [] : [];
    const topCategories = topCategoriesRes.status === "fulfilled" ? topCategoriesRes.value?.rows || [] : [];

    const roleNames = { 1: "Admins", 2: "Clients", 3: "Freelancers", 5: "Partners" };
    const usersByRoleFormatted = usersByRole.map((r) => ({
      label: roleNames[r.role_id] || `Role ${r.role_id}`,
      value: Number(r.count),
    }));

    const escrowByStatus = escrowSummary.reduce((acc, r) => {
      acc[String(r.status).toLowerCase()] = { total: Number(r.total), count: Number(r.count) };
      return acc;
    }, {});

    return res.status(200).json({
      success: true,
      range: `${range}d`,
      kpis: {
        projectsTotal: projectsCount,
        paymentsTotal,
        paymentsCount,
        escrowHeld: Number(escrowByStatus.held?.total || 0),
        escrowReleased: Number(escrowByStatus.released?.total || 0),
        usersByRole: usersByRoleFormatted,
      },
      timeseries: {
        projectsByDay: projectsByDay.map((r) => ({ date: r.day, count: Number(r.count) })),
        paymentsByDay: paymentsByDay.map((r) => ({ date: r.day, total: Number(r.total) })),
      },
      byStatus: projectsByStatus.map((r) => ({ status: r.status, count: Number(r.count) })),
      byType: projectsByType.map((r) => ({ type: r.project_type, count: Number(r.count) })),
      byCountry: usersByCountry.map((r) => ({ country: r.country, count: Number(r.count) })),
      topProjects: topProjects.map((p) => ({
        id: p.id,
        title: p.title,
        applications: Number(p.applications || 0),
        status: p.status,
        createdAt: p.created_at,
      })),
      topCategories: topCategories.map((c) => ({
        name: c.category_name,
        count: Number(c.projects_count),
      })),
    });
  } catch (err) {
    console.error("getAnalyticsAdmin:", err);
    return res.status(500).json({ success: false, message: "Failed to load analytics", error: err.message });
  }
}
