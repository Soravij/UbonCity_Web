export function sweepPurgedDeliverableAssets(assetIds, deleteUnusedAsset, { warn = console.warn } = {}) {
  const result = {
    assets_swept: 0,
    rows_removed: 0,
    files_missing: 0,
    assets_skipped: [],
    asset_sweep_failures: [],
  };
  for (const assetId of [...new Set((Array.isArray(assetIds) ? assetIds : []).map((value) => Number(value || 0)).filter((value) => value > 0))]) {
    try {
      const cleanup = deleteUnusedAsset(assetId) || {};
      if (cleanup.file_removed) result.assets_swept += 1;
      if (cleanup.deleted_asset) result.rows_removed += 1;
      if (cleanup.file_missing) result.files_missing += 1;
      if (!cleanup.deleted_asset && Array.isArray(cleanup.blocked_references) && cleanup.blocked_references.length) {
        result.assets_skipped.push({ asset_id: assetId, blocked_references: cleanup.blocked_references });
      }
      if (cleanup.file_warning) {
        warn(`[purge asset sweep] asset ${assetId}: ${cleanup.file_warning}`);
      }
    } catch (error) {
      const message = String(error?.message || error || "asset sweep failed");
      warn(`[purge asset sweep] asset ${assetId}: ${message}`);
      result.asset_sweep_failures.push({ asset_id: assetId, error: message });
    }
  }
  return result;
}
