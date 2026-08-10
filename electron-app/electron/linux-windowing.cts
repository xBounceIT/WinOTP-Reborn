function shouldForceXWayland({
  platform = process.platform,
  environment = process.env,
  hasOzonePlatformSwitch = false,
}: any = {}) {
  return (
    platform === "linux" &&
    !hasOzonePlatformSwitch &&
    environment.XDG_SESSION_TYPE?.trim().toLowerCase() === "wayland" &&
    typeof environment.DISPLAY === "string" &&
    environment.DISPLAY.trim().length > 0
  );
}

function configureLinuxWindowing(app, options: any = {}) {
  const hasOzonePlatformSwitch =
    options.hasOzonePlatformSwitch ?? app?.commandLine?.hasSwitch?.("ozone-platform") === true;
  if (!shouldForceXWayland({ ...options, hasOzonePlatformSwitch })) {
    return undefined;
  }

  app.commandLine.appendSwitch("ozone-platform", "x11");
  return "x11";
}

module.exports = { configureLinuxWindowing, shouldForceXWayland };
