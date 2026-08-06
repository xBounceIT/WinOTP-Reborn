import { ArrowLeft, Save } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { OtpAccount, OtpAlgorithm, Route } from "@/lib/types";

interface ManualEntryPageProps {
  account?: OtpAccount;
  onNavigate: (route: Route) => void;
  onSave: (account: OtpAccount) => void;
}

interface FormState {
  issuer: string;
  accountName: string;
  secret: string;
  algorithm: OtpAlgorithm;
  digits: "6" | "8";
  period: string;
}

function getFormState(account?: OtpAccount): FormState {
  return {
    issuer: account?.issuer ?? "",
    accountName: account?.accountName ?? "",
    secret: account?.secret ?? "",
    algorithm: account?.algorithm ?? "SHA1",
    digits: account?.digits === 8 ? "8" : "6",
    period: String(account?.period ?? 30),
  };
}

export function ManualEntryPage({ account, onNavigate, onSave }: ManualEntryPageProps) {
  const [form, setForm] = useState<FormState>(() => getFormState(account));
  const [error, setError] = useState("");

  useEffect(() => {
    setForm(getFormState(account));
    setError("");
  }, [account]);

  function updateForm<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function submitForm(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const secret = form.secret.replace(/\s/g, "").toUpperCase();
    const period = Number(form.period);

    if (!form.issuer.trim() && !form.accountName.trim()) {
      setError("Enter an issuer or account name.");
      return;
    }

    onSave({
      id: account?.id ?? crypto.randomUUID(),
      issuer: form.issuer.trim(),
      accountName: form.accountName.trim(),
      secret,
      algorithm: form.algorithm,
      digits: form.digits === "8" ? 8 : 6,
      period,
      createdAt: account?.createdAt ?? new Date().toISOString(),
      usageCount: account?.usageCount ?? 0,
      lastUsedAt: account?.lastUsedAt,
    });
  }

  return (
    <div className="page-scroll">
      <div className="page-shell">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="back-link"
          onClick={() => onNavigate(account ? "home" : "add")}
        >
          <ArrowLeft size={14} />
          Back
        </Button>
        <h1 className="page-title">{account ? "Edit Account" : "Manual Entry"}</h1>

        <form className="form-stack" onSubmit={submitForm}>
          <div className="form-field">
            <Label className="form-field__label" htmlFor="issuer">
              Issuer
            </Label>
            <Input
              id="issuer"
              placeholder="e.g., Google, GitHub, Microsoft"
              value={form.issuer}
              onChange={(event) => updateForm("issuer", event.target.value)}
            />
          </div>

          <div className="form-field">
            <Label className="form-field__label" htmlFor="account-name">
              Account Name
            </Label>
            <Input
              id="account-name"
              placeholder="e.g., user@example.com"
              value={form.accountName}
              onChange={(event) => updateForm("accountName", event.target.value)}
            />
          </div>

          <div className="form-field">
            <Label className="form-field__label" htmlFor="secret">
              Secret Key (Base32)
            </Label>
            <Input
              id="secret"
              autoCapitalize="characters"
              spellCheck={false}
              placeholder="e.g., JBSWY3DPEHPK3PXP"
              value={form.secret}
              onChange={(event) => updateForm("secret", event.target.value.toUpperCase())}
            />
            <span className="form-field__hint">Spaces are ignored. Keep this key private.</span>
          </div>

          <div className="form-field">
            <Label className="form-field__label" htmlFor="algorithm">
              Algorithm
            </Label>
            <Select
              value={form.algorithm}
              onValueChange={(value) => updateForm("algorithm", value as OtpAlgorithm)}
            >
              <SelectTrigger id="algorithm" className="w-full">
                <SelectValue placeholder="Select algorithm" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="SHA1">SHA1</SelectItem>
                <SelectItem value="SHA256">SHA256</SelectItem>
                <SelectItem value="SHA512">SHA512</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="form-field">
            <Label className="form-field__label" htmlFor="digits">
              Digits
            </Label>
            <Select
              value={form.digits}
              onValueChange={(value) => updateForm("digits", value as "6" | "8")}
            >
              <SelectTrigger id="digits" className="w-full">
                <SelectValue placeholder="Select digits" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="6">6</SelectItem>
                <SelectItem value="8">8</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="form-field">
            <Label className="form-field__label" htmlFor="period">
              Period (seconds)
            </Label>
            <Input
              id="period"
              type="number"
              value={form.period}
              onChange={(event) => updateForm("period", event.target.value)}
            />
          </div>

          {error && <div className="inline-error">{error}</div>}

          <div className="form-actions">
            <Button type="submit">
              <Save size={15} />
              {account ? "Save Changes" : "Add Account"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
