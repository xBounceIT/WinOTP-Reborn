import { House, Menu, Settings, X } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { Route } from "@/lib/types";
import { cn } from "@/lib/utils";

interface NavigationRailProps {
  route: Route;
  onNavigate: (route: Route) => void;
}

export function NavigationRail({ route, onNavigate }: NavigationRailProps) {
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!expanded) {
      return;
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setExpanded(false);
      }
    }

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [expanded]);

  function navigate(nextRoute: Route) {
    onNavigate(nextRoute);
    setExpanded(false);
  }

  return (
    <>
      <div className="nav-rail__slot">
        <aside
          id="primary-navigation"
          className={cn("nav-rail", expanded && "nav-rail--expanded")}
          aria-label="Primary navigation"
        >
          <div className="nav-rail__group">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="nav-button nav-toggle"
                  aria-label={expanded ? "Collapse sidebar" : "Expand sidebar"}
                  aria-controls="primary-navigation"
                  aria-expanded={expanded}
                  onClick={() => setExpanded((current) => !current)}
                >
                  {expanded ? (
                    <X size={17} strokeWidth={1.8} />
                  ) : (
                    <Menu size={17} strokeWidth={1.8} />
                  )}
                  <span className="nav-button__label">
                    {expanded ? "Collapse sidebar" : "Expand sidebar"}
                  </span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>{expanded ? "Collapse sidebar" : "Expand sidebar"}</TooltipContent>
            </Tooltip>
          </div>
          <div className="nav-rail__group nav-rail__group--bottom">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className={cn("nav-button", route === "home" && "nav-button--active")}
                  aria-label="Home"
                  aria-current={route === "home" ? "page" : undefined}
                  onClick={() => navigate("home")}
                >
                  <House size={17} strokeWidth={1.8} />
                  <span className="nav-button__label">Home</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>Home</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className={cn("nav-button", route === "settings" && "nav-button--active")}
                  aria-label="Settings"
                  aria-current={route === "settings" ? "page" : undefined}
                  onClick={() => navigate("settings")}
                >
                  <Settings size={17} strokeWidth={1.8} />
                  <span className="nav-button__label">Settings</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>Settings</TooltipContent>
            </Tooltip>
          </div>
        </aside>
      </div>
      <button
        type="button"
        className={cn("nav-scrim", expanded && "nav-scrim--visible")}
        aria-label="Close sidebar"
        aria-hidden={!expanded}
        tabIndex={expanded ? 0 : -1}
        onClick={() => setExpanded(false)}
      />
    </>
  );
}
