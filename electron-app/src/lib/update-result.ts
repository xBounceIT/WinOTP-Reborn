import type { UpdateOperationResult } from "@/lib/types";

export function getUpdateInstallToast(result: UpdateOperationResult) {
  if (result.success) {
    return result.message ?? "The update installer was launched.";
  }
  return result.message ?? "Unable to launch the update installer.";
}
