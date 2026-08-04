import {
  ArrowDownUp,
  Database,
  GripVertical,
  LoaderCircle,
  Plus,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { useMemo, useState, type DragEvent } from "react";

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
import { moveAccountId, sortAccounts, sortOptions } from "@/lib/account-order";
import type { OtpAccount, Route, SortOption } from "@/lib/types";

interface HomePageProps {
  accounts: OtpAccount[];
  sort: SortOption;
  customOrderIds: string[];
  loading: boolean;
  storageError: string;
  showNextCode: boolean;
  accountTiming: Record<string, { remaining: number; progress: number }>;
  codes: Record<string, { code: string; nextCode: string }>;
  onNavigate: (route: Route) => void;
  onSortChange: (sort: SortOption) => void;
  onCustomOrderChange: (orderIds: string[]) => void;
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
  sort,
  customOrderIds,
  loading,
  storageError,
  showNextCode,
  accountTiming,
  codes,
  onNavigate,
  onSortChange,
  onCustomOrderChange,
  onCopy,
  onEdit,
  onDelete,
}: HomePageProps) {
  const [search, setSearch] = useState("");
  const [draggedAccountId, setDraggedAccountId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const isCustomOrder = sort === "CustomOrder";
  const canReorder = isCustomOrder && search.trim().length === 0;

  const visibleAccounts = useMemo(() => {
    const query = search.trim().toLowerCase();
    const filtered = query
      ? accounts.filter((account) =>
          `${account.issuer} ${account.accountName}`.toLowerCase().includes(query),
        )
      : accounts;
    return sortAccounts(filtered, sort, customOrderIds);
  }, [accounts, customOrderIds, search, sort]);

  function moveAccount(accountId: string, direction: -1 | 1) {
    if (!canReorder) {
      return;
    }

    const index = visibleAccounts.findIndex((account) => account.id === accountId);
    const target = visibleAccounts[index + direction];
    if (!target) {
      return;
    }

    const nextOrderIds = moveAccountId(
      visibleAccounts.map((account) => account.id),
      accountId,
      target.id,
      direction > 0,
    );
    onCustomOrderChange(nextOrderIds);
  }

  function handleDragStart(accountId: string) {
    if (!canReorder) {
      return;
    }

    setDraggedAccountId(accountId);
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>, accountId: string) {
    if (!canReorder || !draggedAccountId || draggedAccountId === accountId) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDropTargetId(accountId);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>, accountId: string) {
    if (!canReorder) {
      return;
    }

    event.preventDefault();
    const draggedId = event.dataTransfer.getData("text/plain") || draggedAccountId;
    if (!draggedId || draggedId === accountId) {
      setDraggedAccountId(null);
      setDropTargetId(null);
      return;
    }

    const bounds = event.currentTarget.getBoundingClientRect();
    const placeAfter = event.clientY >= bounds.top + bounds.height / 2;
    const nextOrderIds = moveAccountId(
      visibleAccounts.map((account) => account.id),
      draggedId,
      accountId,
      placeAfter,
    );
    onCustomOrderChange(nextOrderIds);
    setDraggedAccountId(null);
    setDropTargetId(null);
  }

  function handleDragEnd() {
    setDraggedAccountId(null);
    setDropTargetId(null);
  }

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
                  onValueChange={(value) => onSortChange(value as SortOption)}
                >
                  {sortOptions.map((option) => (
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
          <>
            {isCustomOrder && accounts.length > 1 && (
              <div className="custom-order-hint" role="status">
                <GripVertical size={14} strokeWidth={1.8} />
                <span>
                  {canReorder
                    ? "Drag accounts into your preferred order, or use the move buttons."
                    : "Clear search to reorder the full account list."}
                </span>
              </div>
            )}
            <div className="account-list">
              {visibleAccounts.map((account, index) => {
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
                    reorderable={canReorder}
                    canMoveUp={canReorder && index > 0}
                    canMoveDown={canReorder && index < visibleAccounts.length - 1}
                    isDragging={draggedAccountId === account.id}
                    isDropTarget={dropTargetId === account.id}
                    onMoveUp={() => moveAccount(account.id, -1)}
                    onMoveDown={() => moveAccount(account.id, 1)}
                    onDragStart={handleDragStart}
                    onDragOver={handleDragOver}
                    onDrop={handleDrop}
                    onDragEnd={handleDragEnd}
                    onCopy={onCopy}
                    onEdit={onEdit}
                    onDelete={onDelete}
                  />
                );
              })}
            </div>
          </>
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
