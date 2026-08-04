import {
  ArrowDownUp,
  Database,
  LoaderCircle,
  Plus,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";

import { AccountCard } from "@/components/AccountCard";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { OtpAccount, Route, SortOption } from "@/lib/types";

interface HomePageProps {
  accounts: OtpAccount[];
  loading: boolean;
  storageError: string;
  showNextCode: boolean;
  accountTiming: Record<string, { remaining: number; progress: number }>;
  codes: Record<string, { code: string; nextCode: string }>;
  onNavigate: (route: Route) => void;
  onCopy: (account: OtpAccount, code: string) => void;
  onEdit: (account: OtpAccount) => void;
  onDelete: (account: OtpAccount) => void;
}

const sortLabels: Record<SortOption, string> = {
  DateAddedDesc: "Date Added (Newest)",
  DateAddedAsc: "Date Added (Oldest)",
  AlphabeticalAsc: "Name (A → Z)",
  AlphabeticalDesc: "Name (Z → A)",
  CustomOrder: "Custom order",
  UsageBased: "Most used",
};

export function HomePage({
  accounts,
  loading,
  storageError,
  showNextCode,
  accountTiming,
  codes,
  onNavigate,
  onCopy,
  onEdit,
  onDelete,
}: HomePageProps) {
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortOption>("DateAddedDesc");

  const visibleAccounts = useMemo(() => {
    const query = search.trim().toLowerCase();
    const filtered = query
      ? accounts.filter((account) =>
          `${account.issuer} ${account.accountName}`.toLowerCase().includes(query),
        )
      : accounts;

    return [...filtered].sort((left, right) => {
      if (sort === "AlphabeticalAsc") {
        return `${left.issuer}${left.accountName}`.localeCompare(
          `${right.issuer}${right.accountName}`,
        );
      }
      if (sort === "AlphabeticalDesc") {
        return `${right.issuer}${right.accountName}`.localeCompare(
          `${left.issuer}${left.accountName}`,
        );
      }
      if (sort === "DateAddedAsc") {
        return left.createdAt.localeCompare(right.createdAt);
      }
      if (sort === "UsageBased") {
        return (right.usageCount ?? 0) - (left.usageCount ?? 0);
      }
      return right.createdAt.localeCompare(left.createdAt);
    });
  }, [accounts, search, sort]);

  return (
    <div className="page-scroll">
      <div className="page-shell page-shell--home">
        <div className="home-toolbar">
          <div className="search-field">
            <Search className="search-icon" size={15} strokeWidth={1.8} />
            <Input
              aria-label="Search accounts"
              placeholder="Search accounts..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <div className="toolbar-actions">
            <DropdownMenu>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <Button
                      className="toolbar-icon-button"
                      size="icon"
                      variant="outline"
                      aria-label={`Sort accounts: ${sortLabels[sort]}`}
                    >
                      <ArrowDownUp size={15} strokeWidth={1.8} />
                    </Button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent>Sort: {sortLabels[sort]}</TooltipContent>
              </Tooltip>
              <DropdownMenuContent align="end">
                <DropdownMenuRadioGroup
                  value={sort}
                  onValueChange={(value) => setSort(value as SortOption)}
                >
                  {(Object.keys(sortLabels) as SortOption[]).map((option) => (
                    <DropdownMenuRadioItem key={option} value={option}>
                      {sortLabels[option]}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  className="toolbar-icon-button"
                  size="icon"
                  variant="outline"
                  aria-label="Add account"
                  onClick={() => onNavigate("add")}
                >
                  <Plus size={16} strokeWidth={1.8} />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Add account</TooltipContent>
            </Tooltip>
          </div>
        </div>

        {loading ? (
          <div className="empty-state">
            <LoaderCircle className="animate-spin" size={42} strokeWidth={1.2} />
            <div className="empty-state__title">Loading accounts</div>
            <div className="empty-state__detail">Opening the local SQLite database…</div>
          </div>
        ) : storageError ? (
          <div className="empty-state">
            <Database className="empty-state__icon" size={42} strokeWidth={1.2} />
            <div className="empty-state__title">Account storage unavailable</div>
            <div className="empty-state__detail">{storageError}</div>
            <Button variant="ghost" size="sm" onClick={() => window.location.reload()}>
              Try again
            </Button>
          </div>
        ) : visibleAccounts.length > 0 ? (
          <div className="account-list">
            {visibleAccounts.map((account) => {
              const timing = accountTiming[account.id] ?? {
                remaining: account.period,
                progress: Math.max(0, (account.period - 1) / Math.max(1, account.period)),
              };
              const accountCodes = codes[account.id] ?? {
                code: "—".repeat(account.digits),
                nextCode: "—".repeat(account.digits),
              };

              return (
                <AccountCard
                  key={account.id}
                  account={account}
                  code={accountCodes.code}
                  nextCode={accountCodes.nextCode}
                  remaining={timing.remaining}
                  progress={timing.progress}
                  showNextCode={showNextCode}
                  onCopy={onCopy}
                  onEdit={onEdit}
                  onDelete={onDelete}
                />
              );
            })}
          </div>
        ) : (
          <div className="empty-state">
            <SlidersHorizontal className="empty-state__icon" size={42} strokeWidth={1.2} />
            <div className="empty-state__title">
              {search ? "No matching accounts" : "No OTP entries yet"}
            </div>
            <div className="empty-state__detail">
              {search ? "Try a different search term" : "Click Add Account to get started"}
            </div>
            {search && (
              <Button variant="ghost" size="sm" onClick={() => setSearch("")}>
                <X size={14} />
                Clear search
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
