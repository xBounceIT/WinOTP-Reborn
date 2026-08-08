import { Check, ChevronDown, ChevronUp, Copy, GripVertical, Pencil, Trash2 } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type DragEvent } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { isTotpPreviewAvailable } from "@/lib/totp-preview";
import type { OtpAccount } from "@/lib/types";

interface AccountCardProps {
  account: OtpAccount;
  code: string;
  nextCode: string;
  remaining: number;
  progress: number;
  showNextCode: boolean;
  reorderable: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  isDragging: boolean;
  isDropTarget: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDragStart: (accountId: string) => void;
  onDragOver: (event: DragEvent<HTMLDivElement>, accountId: string) => void;
  onDrop: (event: DragEvent<HTMLDivElement>, accountId: string) => void;
  onDragEnd: () => void;
  onCopy: (account: OtpAccount) => Promise<boolean>;
  onEdit: (account: OtpAccount) => void;
  onDelete: (account: OtpAccount) => void;
}

interface CodeTransition {
  from: string;
  to: string;
}

function AnimatedCode({ code }: { code: string }) {
  const displayedCode = useRef(code);
  const [transition, setTransition] = useState<CodeTransition | null>(null);

  useEffect(() => {
    if (code === displayedCode.current) {
      return;
    }

    const from = displayedCode.current;
    displayedCode.current = code;
    setTransition({ from, to: code });
  }, [code]);

  const currentCode = displayedCode.current;

  return (
    <span className="account-card__code-stack" aria-live="polite" aria-atomic="true">
      {transition && (
        <span
          key={`${transition.from}-${transition.to}`}
          className="account-card__code account-card__code-layer account-card__code-layer--outgoing"
          aria-hidden="true"
        >
          {transition.from}
        </span>
      )}
      <span
        key={currentCode}
        className={`account-card__code account-card__code-layer${
          transition ? " account-card__code-layer--incoming" : ""
        }`}
        onAnimationEnd={() => {
          setTransition((activeTransition) =>
            activeTransition?.to === currentCode ? null : activeTransition,
          );
        }}
      >
        {currentCode}
      </span>
    </span>
  );
}

function NextCodePreview({ code, visible }: { code: string; visible: boolean }) {
  const [mounted, setMounted] = useState(visible);

  useEffect(() => {
    if (visible) {
      setMounted(true);
    }
  }, [visible]);

  if (!mounted) {
    return null;
  }

  return (
    <span
      key={code}
      className={`account-card__next-code ${
        visible ? "account-card__next-code--visible" : "account-card__next-code--hiding"
      }`}
      aria-hidden={!visible}
      onAnimationEnd={() => {
        if (!visible) {
          setMounted(false);
        }
      }}
    >
      {code}
    </span>
  );
}

function TickProgress({
  remaining,
  period,
  progress,
}: {
  remaining: number;
  period: number;
  progress: number;
}) {
  const safePeriod = Math.max(1, period);
  const startProgress = Math.min(1, Math.max(0, remaining / safePeriod));
  const [value, setValue] = useState(startProgress);
  const [isAnimating, setIsAnimating] = useState(false);

  useLayoutEffect(() => {
    setIsAnimating(false);
    setValue(startProgress);

    const frame = window.requestAnimationFrame(() => {
      setIsAnimating(true);
      setValue(progress);
    });

    return () => window.cancelAnimationFrame(frame);
  }, [progress, startProgress]);

  return (
    <Progress
      className="account-card__progress"
      value={value * 100}
      aria-label={`${remaining} seconds remaining`}
      indicatorStyle={{
        transition: isAnimating ? "transform 300ms cubic-bezier(0.25, 0.46, 0.45, 0.94)" : "none",
      }}
    />
  );
}

export function AccountCard({
  account,
  code,
  nextCode,
  remaining,
  progress,
  showNextCode,
  reorderable,
  canMoveUp,
  canMoveDown,
  isDragging,
  isDropTarget,
  onMoveUp,
  onMoveDown,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  onCopy,
  onEdit,
  onDelete,
}: AccountCardProps) {
  const [copied, setCopied] = useState(false);
  const accountLabel = account.issuer || account.accountName;
  const isCodeAvailable = isTotpPreviewAvailable(code, account.digits);
  const cardClassName = [
    "account-card",
    reorderable && "account-card--reorderable",
    isDragging && "account-card--dragging",
    isDropTarget && "account-card--drop-target",
  ]
    .filter(Boolean)
    .join(" ");

  async function copyCode() {
    if (!isCodeAvailable) {
      return;
    }
    const succeeded = await onCopy(account);
    if (!succeeded) {
      return;
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  }

  return (
    <Card
      className={cardClassName}
      onDragOver={(event) => onDragOver(event, account.id)}
      onDrop={(event) => onDrop(event, account.id)}
    >
      <div className="account-card__top">
        <div className="account-card__identity-row">
          {reorderable && (
            <div className="account-card__reorder-controls">
              <Button
                type="button"
                className="account-card__drag-handle"
                variant="ghost"
                size="icon-sm"
                draggable
                aria-label={`Drag ${accountLabel} to reorder`}
                title="Drag to reorder"
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData("text/plain", account.id);
                  onDragStart(account.id);
                }}
                onDragEnd={onDragEnd}
              >
                <GripVertical size={15} strokeWidth={1.8} />
              </Button>
              <div className="account-card__move-actions">
                <Button
                  type="button"
                  className="account-card__move-button"
                  variant="ghost"
                  size="icon-xs"
                  disabled={!canMoveUp}
                  aria-label={`Move ${accountLabel} up`}
                  title="Move up"
                  onClick={onMoveUp}
                >
                  <ChevronUp size={13} strokeWidth={1.8} />
                </Button>
                <Button
                  type="button"
                  className="account-card__move-button"
                  variant="ghost"
                  size="icon-xs"
                  disabled={!canMoveDown}
                  aria-label={`Move ${accountLabel} down`}
                  title="Move down"
                  onClick={onMoveDown}
                >
                  <ChevronDown size={13} strokeWidth={1.8} />
                </Button>
              </div>
            </div>
          )}
          <div className="account-card__identity">
            <div className="account-card__issuer" title={accountLabel}>
              {accountLabel}
            </div>
            {account.issuer && (
              <div className="account-card__account" title={account.accountName}>
                {account.accountName}
              </div>
            )}
          </div>
        </div>
        <div className="account-card__actions">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                className="account-card__action"
                variant="ghost"
                size="icon-sm"
                aria-label={`Copy ${accountLabel} code`}
                disabled={!isCodeAvailable}
                onClick={() => void copyCode()}
              >
                {copied ? <Check size={14} /> : <Copy size={14} />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {copied ? "Copied" : isCodeAvailable ? "Copy TOTP code" : "Code unavailable"}
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                className="account-card__action"
                variant="ghost"
                size="icon-sm"
                aria-label={`Edit ${accountLabel}`}
                onClick={() => onEdit(account)}
              >
                <Pencil size={14} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Edit account</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                className="account-card__action account-card__action--danger"
                variant="ghost"
                size="icon-sm"
                aria-label={`Delete ${accountLabel}`}
                onClick={() => onDelete(account)}
              >
                <Trash2 size={14} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Delete account</TooltipContent>
          </Tooltip>
        </div>
      </div>

      <div className="account-card__code-row">
        <AnimatedCode code={code} />
        <NextCodePreview code={nextCode} visible={showNextCode && remaining <= 5} />
      </div>

      <div className="account-card__timer">
        <TickProgress remaining={remaining} period={account.period} progress={progress} />
        <span className="account-card__remaining">{remaining}s</span>
      </div>

      <span className="sr-only">
        {remaining} seconds remain in this {account.period}-second code period.
      </span>
    </Card>
  );
}
