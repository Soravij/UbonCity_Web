let lifecycleInfrastructureReady = false;

export function assertLifecycleInfrastructureReady() {
  if (!lifecycleInfrastructureReady) {
    throw new Error("Lifecycle infrastructure is not initialized");
  }
}

export function markLifecycleInfrastructureReady() {
  lifecycleInfrastructureReady = true;
}
