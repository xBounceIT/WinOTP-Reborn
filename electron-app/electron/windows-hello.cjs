const path = require("node:path");
const { spawn } = require("node:child_process");

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_BYTES = 16 * 1024;

const windowsHelloPreamble = String.raw`
$ErrorActionPreference = "Stop"

Add-Type -TypeDefinition @'
using System.Runtime.InteropServices;

public static class WinOtpWindowsSession
{
    [DllImport("user32.dll")]
    public static extern int GetSystemMetrics(int index);
}
'@

function Write-WinOtpResult {
    param([Parameter(Mandatory = $true)][string] $Status)

    [Console]::WriteLine((@{
        ok = $true
        status = $Status
    } | ConvertTo-Json -Compress))
}
`;

const windowsHelloRuntimeHelpers = String.raw`
Add-Type -AssemblyName System.Runtime.WindowsRuntime

function Invoke-WinOtpWindowsRuntimeOperation {
    param(
        [Parameter(Mandatory = $true)]
        [object] $Operation,
        [Parameter(Mandatory = $true)]
        [type] $ResultType
    )

    $asTaskMethod = [System.WindowsRuntimeSystemExtensions].GetMethods() |
        Where-Object {
            $_.Name -eq "AsTask" -and
            $_.IsGenericMethodDefinition -and
            $_.GetGenericArguments().Count -eq 1 -and
            $_.GetParameters().Count -eq 1
        } |
        Select-Object -First 1

    if ($null -eq $asTaskMethod) {
        throw "Unable to await the Windows Runtime operation."
    }

    $task = $asTaskMethod.MakeGenericMethod($ResultType).Invoke($null, @($Operation))
    return $task.GetAwaiter().GetResult()
}

`;

const windowsHelloDesktopInteropSource = String.raw`
using System;
using System.Runtime.InteropServices;
using System.Threading;

public static class WinOtpWindowsHelloDesktopInterop
{
    private const int AsyncStarted = 0;
    private const int AsyncCompleted = 1;
    private const int AsyncCanceled = 2;
    private const int AsyncError = 3;

    private static readonly Guid UserConsentVerifierInteropIid =
        new Guid("39E050C3-4E74-441A-8DC0-B81104DF949C");
    private static readonly Guid AsyncInfoIid =
        new Guid("00000036-0000-0000-C000-000000000046");
    private static readonly Guid UserConsentVerificationOperationIid =
        new Guid("fd596ffd-2318-558f-9dbe-d21df43764a5");

    [DllImport("combase.dll", CharSet = CharSet.Unicode)]
    private static extern int WindowsCreateString(
        [MarshalAs(UnmanagedType.LPWStr)] string sourceString,
        int length,
        out IntPtr hstring);

    [DllImport("combase.dll")]
    private static extern int WindowsDeleteString(IntPtr hstring);

    [DllImport("combase.dll")]
    private static extern int RoGetActivationFactory(
        IntPtr activatableClassId,
        ref Guid iid,
        out IntPtr factory);

    [UnmanagedFunctionPointer(CallingConvention.StdCall)]
    private delegate int RequestVerificationForWindowAsyncDelegate(
        IntPtr self,
        IntPtr appWindow,
        IntPtr message,
        ref Guid operationIid,
        out IntPtr operation);

    [UnmanagedFunctionPointer(CallingConvention.StdCall)]
    private delegate int GetStatusDelegate(IntPtr self, out int status);

    [UnmanagedFunctionPointer(CallingConvention.StdCall)]
    private delegate int GetResultsDelegate(IntPtr self, out int result);

    private static void ThrowIfFailed(int hresult)
    {
        if (hresult < 0)
        {
            Marshal.ThrowExceptionForHR(hresult);
        }
    }

    private static void Release(IntPtr pointer)
    {
        if (pointer != IntPtr.Zero)
        {
            Marshal.Release(pointer);
        }
    }

    public static string Verify(IntPtr appWindow, string message)
    {
        if (appWindow == IntPtr.Zero)
        {
            throw new ArgumentException("A valid application window is required.", "appWindow");
        }

        IntPtr className = IntPtr.Zero;
        IntPtr hstringMessage = IntPtr.Zero;
        IntPtr factory = IntPtr.Zero;
        IntPtr operation = IntPtr.Zero;
        IntPtr asyncInfo = IntPtr.Zero;

        try
        {
            ThrowIfFailed(WindowsCreateString(
                "Windows.Security.Credentials.UI.UserConsentVerifier",
                "Windows.Security.Credentials.UI.UserConsentVerifier".Length,
                out className));
            ThrowIfFailed(WindowsCreateString(message, message.Length, out hstringMessage));
            var interopIid = UserConsentVerifierInteropIid;
            ThrowIfFailed(RoGetActivationFactory(
                className,
                ref interopIid,
                out factory));

            var factoryVtable = Marshal.ReadIntPtr(factory);
            var requestMethodPointer = Marshal.ReadIntPtr(factoryVtable, IntPtr.Size * 6);
            var requestMethod = (RequestVerificationForWindowAsyncDelegate)
                Marshal.GetDelegateForFunctionPointer(
                    requestMethodPointer,
                    typeof(RequestVerificationForWindowAsyncDelegate));

            var operationIid = UserConsentVerificationOperationIid;
            ThrowIfFailed(requestMethod(
                factory,
                appWindow,
                hstringMessage,
                ref operationIid,
                out operation));
            var asyncInfoIid = AsyncInfoIid;
            ThrowIfFailed(Marshal.QueryInterface(operation, ref asyncInfoIid, out asyncInfo));

            var asyncInfoVtable = Marshal.ReadIntPtr(asyncInfo);
            var getStatusMethodPointer = Marshal.ReadIntPtr(asyncInfoVtable, IntPtr.Size * 7);
            var getStatusMethod = (GetStatusDelegate)
                Marshal.GetDelegateForFunctionPointer(
                    getStatusMethodPointer,
                    typeof(GetStatusDelegate));

            var operationVtable = Marshal.ReadIntPtr(operation);
            var getResultsMethodPointer = Marshal.ReadIntPtr(operationVtable, IntPtr.Size * 8);
            var getResultsMethod = (GetResultsDelegate)
                Marshal.GetDelegateForFunctionPointer(
                    getResultsMethodPointer,
                    typeof(GetResultsDelegate));

            var deadline = DateTime.UtcNow.AddSeconds(110);
            while (true)
            {
                int status;
                ThrowIfFailed(getStatusMethod(asyncInfo, out status));

                if (status == AsyncCompleted)
                {
                    int result;
                    ThrowIfFailed(getResultsMethod(operation, out result));
                    switch (result)
                    {
                        case 0:
                            return "Verified";
                        case 1:
                            return "DeviceNotPresent";
                        case 2:
                            return "NotConfiguredForUser";
                        case 3:
                            return "DisabledByPolicy";
                        case 4:
                            return "DeviceBusy";
                        case 5:
                            return "RetriesExhausted";
                        case 6:
                            return "Canceled";
                        default:
                            return "Error";
                    }
                }

                if (status == AsyncCanceled)
                {
                    return "Canceled";
                }

                if (status == AsyncError)
                {
                    return "Error";
                }

                if (status != AsyncStarted || DateTime.UtcNow >= deadline)
                {
                    return "Timeout";
                }

                Thread.Sleep(50);
            }
        }
        finally
        {
            Release(asyncInfo);
            Release(operation);
            Release(factory);
            if (hstringMessage != IntPtr.Zero)
            {
                WindowsDeleteString(hstringMessage);
            }
            if (className != IntPtr.Zero)
            {
                WindowsDeleteString(className);
            }
        }
    }
}
`;

const WINDOWS_HELLO_AVAILABILITY_SCRIPT = `${windowsHelloPreamble}${windowsHelloRuntimeHelpers}
if ([WinOtpWindowsSession]::GetSystemMetrics(0x1000) -ne 0) {
    Write-WinOtpResult "RemoteSession"
    exit 0
}

$operation = [Windows.Security.Credentials.UI.UserConsentVerifier,Windows,ContentType=WindowsRuntime]::CheckAvailabilityAsync()
$availability = Invoke-WinOtpWindowsRuntimeOperation $operation ([Windows.Security.Credentials.UI.UserConsentVerifierAvailability,Windows,ContentType=WindowsRuntime])
Write-WinOtpResult ([string]$availability)
exit 0
`;

const WINDOWS_HELLO_VERIFY_SCRIPT = `${windowsHelloPreamble}
if ([WinOtpWindowsSession]::GetSystemMetrics(0x1000) -ne 0) {
    Write-WinOtpResult "RemoteSession"
    exit 0
}

$windowHandle = [IntPtr]([long]__WINOTP_WINDOW_HANDLE__)
Add-Type -TypeDefinition @'
${windowsHelloDesktopInteropSource}
'@
$verification = [WinOtpWindowsHelloDesktopInterop]::Verify($windowHandle, "Verify your identity for WinOTP")
Write-WinOtpResult ([string]$verification)
exit 0
`;

const unavailableAvailabilityResults = new Set([
  "DeviceNotPresent",
  "NotConfiguredForUser",
  "DisabledByPolicy",
]);

const unavailableVerificationResults = unavailableAvailabilityResults;

function getWindowsPowerShellPath(environment = process.env) {
  const windowsDirectory = environment.SystemRoot || environment.WINDIR;
  return windowsDirectory
    ? path.join(windowsDirectory, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
    : undefined;
}

function parsePowerShellResult(output) {
  try {
    const parsed = JSON.parse(String(output ?? "").trim());
    if (parsed?.ok === true && typeof parsed.status === "string") {
      return parsed.status;
    }
  } catch {
    // The PowerShell process may fail before it can return a result.
  }

  return undefined;
}

function mapAvailabilityStatus(status) {
  if (status === "Available") {
    return "available";
  }
  if (status === "RemoteSession") {
    return "remote-session";
  }
  if (unavailableAvailabilityResults.has(status)) {
    return "unavailable";
  }
  return "error";
}

function mapVerificationStatus(status) {
  if (status === "Verified") {
    return "verified";
  }
  if (status === "RemoteSession") {
    return "remote-session";
  }
  if (unavailableVerificationResults.has(status)) {
    return "unavailable";
  }
  if (status === "Canceled" || status === "Cancelled") {
    return "canceled";
  }
  if (status === "DeviceBusy" || status === "RetriesExhausted") {
    return "failed";
  }
  return "error";
}

function serializeWindowHandle(windowHandle) {
  if (!Buffer.isBuffer(windowHandle) || ![4, 8].includes(windowHandle.length)) {
    return undefined;
  }

  let value = 0n;
  for (let index = 0; index < windowHandle.length; index += 1) {
    value |= BigInt(windowHandle[index]) << BigInt(index * 8);
  }

  if (value === 0n || value > 0x7fffffffffffffffn) {
    return undefined;
  }

  return value.toString(10);
}

function runPowerShellScript(script, options = {}) {
  const platform = options.platform ?? process.platform;
  if (platform !== "win32") {
    return Promise.resolve({ ok: false, error: "Windows Hello is only available on Windows." });
  }

  const powershellPath = options.powershellPath ?? getWindowsPowerShellPath(options.environment);
  if (!powershellPath) {
    return Promise.resolve({ ok: false, error: "Unable to locate Windows PowerShell." });
  }

  const spawnProcess = options.spawnProcess ?? spawn;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const args = [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-Sta",
    "-Command",
    script,
  ];

  return new Promise((resolve) => {
    let child;
    let stdout = "";
    let settled = false;
    let timeout;

    const settle = (result) => {
      if (settled) {
        return;
      }

      settled = true;
      if (timeout) {
        clearTimeout(timeout);
      }
      resolve(result);
    };

    const terminate = () => {
      try {
        child?.kill();
      } catch {
        // The process may have already exited.
      }
    };

    try {
      child = spawnProcess(powershellPath, args, {
        windowsHide: true,
        stdio: ["ignore", "pipe", "ignore"],
      });
    } catch {
      settle({ ok: false, error: "Unable to start Windows Hello." });
      return;
    }

    if (!child?.stdout?.on || typeof child.on !== "function") {
      terminate();
      settle({ ok: false, error: "Unable to read the Windows Hello result." });
      return;
    }

    child.stdout.on("data", (chunk) => {
      if (settled) {
        return;
      }

      stdout += String(chunk);
      if (Buffer.byteLength(stdout, "utf8") > MAX_OUTPUT_BYTES) {
        terminate();
        settle({ ok: false, error: "Windows Hello returned too much data." });
      }
    });

    child.on("error", () => {
      settle({ ok: false, error: "Unable to start Windows Hello." });
    });

    child.on("close", (code) => {
      if (code !== 0) {
        settle({ ok: false, error: "Windows Hello verification failed to start." });
        return;
      }

      const status = parsePowerShellResult(stdout);
      settle(
        status
          ? { ok: true, status }
          : { ok: false, error: "Windows Hello returned an invalid result." },
      );
    });

    timeout = setTimeout(() => {
      terminate();
      settle({ ok: false, error: "Windows Hello timed out." });
    }, timeoutMs);
  });
}

async function getWindowsHelloAvailability(options = {}) {
  const result = await runPowerShellScript(WINDOWS_HELLO_AVAILABILITY_SCRIPT, options);
  return { status: result.ok ? mapAvailabilityStatus(result.status) : "error" };
}

async function verifyWindowsHello(options = {}) {
  const windowHandle = serializeWindowHandle(options.windowHandle);
  if (!windowHandle) {
    return { status: "error" };
  }

  const script = WINDOWS_HELLO_VERIFY_SCRIPT.replace("__WINOTP_WINDOW_HANDLE__", windowHandle);
  const result = await runPowerShellScript(script, options);
  return { status: result.ok ? mapVerificationStatus(result.status) : "error" };
}

module.exports = {
  DEFAULT_TIMEOUT_MS,
  WINDOWS_HELLO_AVAILABILITY_SCRIPT,
  WINDOWS_HELLO_VERIFY_SCRIPT,
  windowsHelloDesktopInteropSource,
  getWindowsHelloAvailability,
  getWindowsPowerShellPath,
  mapAvailabilityStatus,
  mapVerificationStatus,
  parsePowerShellResult,
  runPowerShellScript,
  serializeWindowHandle,
  verifyWindowsHello,
};
