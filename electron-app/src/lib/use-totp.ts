import { useEffect, useMemo, useState } from "react";

import { generateTotpCode, getRemainingSeconds } from "@/lib/totp";
import type { OtpAccount } from "@/lib/types";

interface CodeState {
  code: string;
  nextCode: string;
}

export function useTotp(accounts: OtpAccount[]) {
  const [timestamp, setTimestamp] = useState(() => Date.now());
  const [codes, setCodes] = useState<Record<string, CodeState>>({});

  useEffect(() => {
    let timer = 0;

    function scheduleNextTick() {
      const millisecondsToNextSecond = 1000 - (Date.now() % 1000);
      timer = window.setTimeout(
        () => {
          setTimestamp(Date.now());
          scheduleNextTick();
        },
        Math.max(100, millisecondsToNextSecond),
      );
    }

    scheduleNextTick();
    return () => window.clearTimeout(timer);
  }, []);

  const codeTimestamp = Math.floor(timestamp / 1000) * 1000;

  useEffect(() => {
    let cancelled = false;

    async function updateCodes() {
      const entries = await Promise.all(
        accounts.map(async (account) => {
          const remaining = getRemainingSeconds(account, codeTimestamp);
          const nextCode = await generateTotpCode(account, codeTimestamp + remaining * 1000);
          const code = await generateTotpCode(account, codeTimestamp);
          return [account.id, { code, nextCode }] as const;
        }),
      );

      if (!cancelled) {
        setCodes(Object.fromEntries(entries));
      }
    }

    void updateCodes();
    return () => {
      cancelled = true;
    };
  }, [accounts, codeTimestamp]);

  const accountTiming = useMemo(
    () =>
      Object.fromEntries(
        accounts.map((account) => {
          const remaining = getRemainingSeconds(account, timestamp);
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
    [accounts, timestamp],
  );

  return { accountTiming, codes };
}
