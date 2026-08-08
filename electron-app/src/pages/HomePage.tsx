import {
  ArrowDownUp,
  Database,
  GripVertical,
  Plus,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";

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
import { projectOrderWithCore, sortAccountsWithCore, sortOptions } from "@/lib/account-order";
import type { OtpAccount, Route, SortOption } from "@/lib/types";

interface HomePageProps {
  accounts: OtpAccount[];
  sort: SortOption;
  customOrderIds: string[];
  storageError: string;
  showNextCode: boolean;
  accountTiming: Record<string, { remaining: number; progress: number }>;
  codes: Record<string, { code: string; nextCode: string }>;
  onNavigate: (route: Route) => void;
  onSortChange: (sort: SortOption) => void;
  onCustomOrderChange: (orderIds: string[]) => void;
  onCopy: (account: OtpAccount) => Promise<boolean>;
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

function reorderVisibleAccounts(current: OtpAccount[], orderIds: readonly string[]) {
  const accountById = new Map(current.map((account) => [account.id, account]));
  const seen = new Set<string>();
  const ordered: OtpAccount[] = [];
  for (const id of orderIds) {
    const account = accountById.get(id);
    if (account && !seen.has(id)) {
      seen.add(id);
      ordered.push(account);
    }
  }
  for (const account of current) {
    if (!seen.has(account.id)) {
      seen.add(account.id);
      ordered.push(account);
    }
  }
  return ordered;
}

interface AccountListProps {
  accounts: OtpAccount[];
  accountTiming: HomePageProps["accountTiming"];
  codes: HomePageProps["codes"];
  showNextCode: boolean;
  canReorder: boolean;
  orderProjectionPending: boolean;
  draggedAccountId: string | null;
  dropTargetId: string | null;
  onMoveUp: (accountId: string) => void;
  onMoveDown: (accountId: string) => void;
  onDragStart: (accountId: string) => void;
  onDragOver: (event: DragEvent<HTMLDivElement>, accountId: string) => void;
  onDrop: (event: DragEvent<HTMLDivElement>, accountId: string) => void;
  onDragEnd: () => void;
  onCopy: HomePageProps["onCopy"];
  onEdit: HomePageProps["onEdit"];
  onDelete: HomePageProps["onDelete"];
}

function AccountList({
  accounts,
  accountTiming,
  codes,
  showNextCode,
  canReorder,
  orderProjectionPending,
  draggedAccountId,
  dropTargetId,
  onMoveUp,
  onMoveDown,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  onCopy,
  onEdit,
  onDelete,
}: AccountListProps) {
  return (
    <div className="account-list">
      {accounts.map((account, index) => {
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
            view={{
              showNextCode,
              reorderable: canReorder && !orderProjectionPending,
              canMoveUp: canReorder && !orderProjectionPending && index > 0,
              canMoveDown: canReorder && !orderProjectionPending && index < accounts.length - 1,
              isDragging: draggedAccountId === account.id,
              isDropTarget: dropTargetId === account.id,
            }}
            onMoveUp={() => onMoveUp(account.id)}
            onMoveDown={() => onMoveDown(account.id)}
            onDragStart={onDragStart}
            onDragOver={onDragOver}
            onDrop={onDrop}
            onDragEnd={onDragEnd}
            onCopy={onCopy}
            onEdit={onEdit}
            onDelete={onDelete}
          />
        );
      })}
    </div>
  );
}

export function HomePage({
  accounts,
  sort,
  customOrderIds,
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
  const [visibleAccounts, setVisibleAccounts] = useState<OtpAccount[]>(accounts);
  const [orderProjectionPending, setOrderProjectionPending] = useState(false);
  const orderProjectionPendingRef = useRef(false);
  const isCustomOrder = sort === "CustomOrder";
  const canReorder = isCustomOrder && search.trim().length === 0;

  const filteredAccounts = useMemo(() => {
    const query = search.trim().toLowerCase();
    return query
      ? accounts.filter((account) =>
          `${account.issuer} ${account.accountName}`.toLowerCase().includes(query),
        )
      : accounts;
  }, [accounts, search]);

  useEffect(() => {
    let cancelled = false;
    void sortAccountsWithCore(filteredAccounts, sort, customOrderIds).then((result) => {
      if (!cancelled) {
        setVisibleAccounts(result);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [customOrderIds, filteredAccounts, sort]);

  async function projectCustomOrder(
    orderIds: readonly string[],
    draggedId: string,
    insertionIndex: number,
  ) {
    if (!canReorder || orderProjectionPendingRef.current) {
      return;
    }

    orderProjectionPendingRef.current = true;
    setOrderProjectionPending(true);
    try {
      const nextOrderIds = await projectOrderWithCore(orderIds, draggedId, insertionIndex);
      setVisibleAccounts((current) => reorderVisibleAccounts(current, nextOrderIds));
      onCustomOrderChange(nextOrderIds);
    } finally {
      orderProjectionPendingRef.current = false;
      setOrderProjectionPending(false);
    }
  }

  async function moveAccount(accountId: string, direction: -1 | 1) {
    if (!canReorder || orderProjectionPendingRef.current) {
      return;
    }

    const index = visibleAccounts.findIndex((account) => account.id === accountId);
    const target = visibleAccounts[index + direction];
    if (!target) {
      return;
    }

    const targetIndex = visibleAccounts.findIndex((account) => account.id === target.id);
    const insertionIndex = targetIndex + (direction > 0 ? 1 : 0);
    await projectCustomOrder(
      visibleAccounts.map((account) => account.id),
      accountId,
      insertionIndex,
    );
  }

  function handleDragStart(accountId: string) {
    if (!canReorder || orderProjectionPendingRef.current) {
      return;
    }

    setDraggedAccountId(accountId);
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>, accountId: string) {
    if (
      !canReorder ||
      orderProjectionPendingRef.current ||
      !draggedAccountId ||
      draggedAccountId === accountId
    ) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDropTargetId(accountId);
  }

  async function handleDrop(event: DragEvent<HTMLDivElement>, accountId: string) {
    if (!canReorder || orderProjectionPendingRef.current) {
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
    const targetIndex = visibleAccounts.findIndex((account) => account.id === accountId);
    await projectCustomOrder(
      visibleAccounts.map((account) => account.id),
      draggedId,
      targetIndex + (placeAfter ? 1 : 0),
    );
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

        {storageError ? (
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
            <AccountList
              accounts={visibleAccounts}
              accountTiming={accountTiming}
              codes={codes}
              showNextCode={showNextCode}
              canReorder={canReorder}
              orderProjectionPending={orderProjectionPending}
              draggedAccountId={draggedAccountId}
              dropTargetId={dropTargetId}
              onMoveUp={(accountId) => void moveAccount(accountId, -1)}
              onMoveDown={(accountId) => void moveAccount(accountId, 1)}
              onDragStart={handleDragStart}
              onDragOver={handleDragOver}
              onDrop={handleDrop}
              onDragEnd={handleDragEnd}
              onCopy={onCopy}
              onEdit={onEdit}
              onDelete={onDelete}
            />
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
