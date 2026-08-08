import { useEffect, useMemo, useState } from "react";

import { areTotpPreviewsAvailable } from "@/lib/totp-preview";
import type { OtpAccount, TotpPreview } from "@/lib/types";

type CodeState = TotpPreview;

function placeholderPreview(digits: number): CodeState {
  const code = "—".repeat(digits === 8 ? 8 : 6);
  return { code, nextCode: code, remainingSeconds: 0 };
}

export function useTotp(accounts: OtpAccount[], enabled = true) {
  const [timestamp, setTimestamp] = useState(() => Date.now());
  const [codes, setCodes] = useState<Record<string, CodeState>>({});

  useEffect(() => {
    if (!enabled) {
      return;
    }

    let timer = 0;
    let cancelled = false;

    setTimestamp(Date.now());

    function scheduleNextTick() {
      if (cancelled) {
        return;
      }

      const millisecondsToNextSecond = 1000 - (Date.now() % 1000);
      timer = window.setTimeout(
        () => {
          if (cancelled) {
            return;
          }
          setTimestamp(Date.now());
          scheduleNextTick();
        },
        Math.max(100, millisecondsToNextSecond),
      );
    }

    scheduleNextTick();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [enabled]);

  const codeTimestamp = Math.floor(timestamp / 1000) * 1000;

  useEffect(() => {
    let cancelled = false;

    if (!enabled) {
      setCodes({});
      return () => {
        cancelled = true;
      };
    }

    async function updateCodes() {
      const bridge = window.winotp?.totp;
      let previews: TotpPreview[] = [];
      try {
        previews = bridge
          ? await bridge.previews(
              accounts.map((account) => account.id),
              codeTimestamp,
            )
          : [];
      } catch {
        // Keep placeholders visible while the Rust sidecar is unavailable.
      }
      const entries = accounts.map(
        (account, index) =>
          [account.id, previews[index] ?? placeholderPreview(account.digits)] as const,
      );

      if (!cancelled) {
        setCodes(Object.fromEntries(entries));
      }
    }

    void updateCodes();
    return () => {
      cancelled = true;
    };
  }, [accounts, codeTimestamp, enabled]);

  const visibleCodes = useMemo(() => (enabled ? codes : {}), [codes, enabled]);
  const loading = enabled && !areTotpPreviewsAvailable(accounts, codes);

  const accountTiming = useMemo(
    () =>
      Object.fromEntries(
        accounts.map((account) => {
          const remaining =
            visibleCodes[account.id]?.remainingSeconds ?? Math.max(1, account.period);
          const period = Math.max(1, account.period);
          const progress = (remaining - 1) / period;
          return [
            account.id,
            {
              remaining,
              progress: Math.min(1, Math.max(0, progress)),
            },
          ];
        }),
      ),
    [accounts, visibleCodes],
  );

  return { accountTiming, codes: visibleCodes, loading };
}
