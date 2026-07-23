let importReviewInfrastructureReady = false;

export function assertImportReviewInfrastructureReady() {
  if (!importReviewInfrastructureReady) {
    throw new Error("Import review infrastructure is not initialized");
  }
}

export function markImportReviewInfrastructureReady() {
  importReviewInfrastructureReady = true;
}
