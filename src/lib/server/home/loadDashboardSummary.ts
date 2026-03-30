async function getProjectsByIds(
  supabase: Awaited<ReturnType<typeof createClient>>,
  projectIds: string[],
): Promise<any[]> {
  if (!projectIds.length) return [];

  const selectSets = [
    `
      id,
      title,
      client_name,
      project_code,
      status,
      lifecycle_state,
      state,
      phase,
      department,
      project_manager,
      project_manager_id,
      pm_name,
      pm_user_id,
      resource_status
    `,
    `
      id,
      title,
      client_name,
      project_code,
      status,
      lifecycle_state,
      state,
      phase,
      department,
      project_manager,
      project_manager_id,
      resource_status
    `,
    `
      id,
      title,
      client_name,
      project_code,
      status,
      lifecycle_state,
      state,
      phase,
      department,
      project_manager,
      project_manager_id
    `,
    `
      id,
      title,
      project_code,
      status,
      lifecycle_state,
      state,
      phase,
      department,
      project_manager,
      project_manager_id
    `,
    `
      id,
      title,
      project_code,
      status
    `,
    `
      id,
      title,
      project_code
    `,
    `
      id,
      title
    `,
  ];

  let lastError: any = null;

  for (const sel of selectSets) {
    const { data, error } = await supabase
      .from("projects")
      .select(sel)
      .in("id", projectIds)
      .limit(5000);

    if (!error && Array.isArray(data)) return data;

    lastError = error;
    if (!(looksMissingRelation(error) || looksMissingColumn(error))) break;
  }

  console.warn("[dashboard-summary:getProjectsByIds] failed to load project rows", {
    requestedIds: projectIds.length,
    error: safeStr(lastError?.message || lastError),
  });

  return [];
}