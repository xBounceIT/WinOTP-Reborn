import type { OtpAccount } from "@/lib/types";

export async function parseOtpUri(uri: string): Promise<OtpAccount | undefined> {
  try {
    return await window.winotp?.core.parseOtpUri(uri);
  } catch {
    return undefined;
  }
}
