import { FileArchive, FileCode2 } from "lucide-react";
import { useRef } from "react";

import { Button } from "@/components/ui/button";

interface ImportPageProps {
  onToast: (message: string) => void;
}

export function ImportPage({ onToast }: ImportPageProps) {
  const legacyInput = useRef<HTMLInputElement>(null);
  const winAuthInput = useRef<HTMLInputElement>(null);

  function handleFile(event: React.ChangeEvent<HTMLInputElement>, source: string) {
    const file = event.target.files?.[0];
    if (file) {
      onToast(`Selected ${file.name} for ${source}.`);
    }
    event.target.value = "";
  }

  return (
    <div className="page-scroll">
      <div className="page-shell">
        <h1 className="page-title">Import Accounts</h1>
        <div className="choice-list">
          <Button
            type="button"
            variant="outline"
            className="choice-card"
            onClick={() => legacyInput.current?.click()}
          >
            <span className="choice-card__icon">
              <FileArchive size={24} strokeWidth={1.6} />
            </span>
            <span className="choice-card__copy">
              <span className="choice-card__title">Import from WinOTP (old)</span>
              <span className="choice-card__detail">
                Import tokens from legacy WinOTP JSON backup file
              </span>
            </span>
          </Button>
          <input
            ref={legacyInput}
            className="sr-only"
            type="file"
            accept=".json,application/json"
            aria-label="Select a legacy WinOTP backup"
            onChange={(event) => handleFile(event, "legacy WinOTP")}
          />

          <Button
            type="button"
            variant="outline"
            className="choice-card"
            onClick={() => winAuthInput.current?.click()}
          >
            <span className="choice-card__icon">
              <FileCode2 size={24} strokeWidth={1.6} />
            </span>
            <span className="choice-card__copy">
              <span className="choice-card__title">Import from WinAuth</span>
              <span className="choice-card__detail">
                Import tokens from WinAuth exported text file
              </span>
            </span>
          </Button>
          <input
            ref={winAuthInput}
            className="sr-only"
            type="file"
            accept=".txt,text/plain"
            aria-label="Select a WinAuth export"
            onChange={(event) => handleFile(event, "WinAuth")}
          />
        </div>
      </div>
    </div>
  );
}
