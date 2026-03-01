using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;

namespace WinOTP.Services;

public interface IAutoLockService
{
    bool IsMonitoring { get; }
    void StartMonitoring();
    void StopMonitoring();
    void ResetTimer();
    void SetDispatcherQueue(DispatcherQueue dispatcherQueue);
    event EventHandler? LockRequested;
}

public class AutoLockService : IAutoLockService
{
    private DispatcherQueue? _dispatcherQueue;
    private DispatcherQueueTimer? _timer;
    private readonly IAppSettingsService _appSettings;
    private DateTime _lastActivityTime;
    private bool _isMonitoring;

    public bool IsMonitoring => _isMonitoring;

    public event EventHandler? LockRequested;

    public AutoLockService(IAppSettingsService appSettings)
    {
        _appSettings = appSettings;
        _lastActivityTime = DateTime.Now;
    }

    public void SetDispatcherQueue(DispatcherQueue dispatcherQueue)
    {
        if (_dispatcherQueue != null)
            return;

        _dispatcherQueue = dispatcherQueue;
        _timer = _dispatcherQueue.CreateTimer();
        _timer.Interval = TimeSpan.FromSeconds(10);
        _timer.Tick += OnTimerTick;
    }

    public void StartMonitoring()
    {
        if (_isMonitoring)
            return;

        // Only monitor if auto-lock is enabled and some protection is active
        if (!ShouldMonitor())
            return;

        _isMonitoring = true;
        _lastActivityTime = DateTime.Now;
        _timer?.Start();
    }

    public void StopMonitoring()
    {
        _isMonitoring = false;
        _timer?.Stop();
    }

    public void ResetTimer()
    {
        _lastActivityTime = DateTime.Now;
    }

    private bool ShouldMonitor()
    {
        // Only monitor if auto-lock timeout is set (not 0) and some protection is enabled
        return _appSettings.AutoLockTimeoutMinutes > 0 &&
               (_appSettings.IsPinProtectionEnabled ||
                _appSettings.IsPasswordProtectionEnabled ||
                _appSettings.IsWindowsHelloEnabled);
    }

    private void OnTimerTick(DispatcherQueueTimer sender, object args)
    {
        if (!_isMonitoring)
            return;

        // Check if auto-lock setting changed
        if (!ShouldMonitor())
        {
            StopMonitoring();
            return;
        }

        var timeout = TimeSpan.FromMinutes(_appSettings.AutoLockTimeoutMinutes);
        var inactiveDuration = DateTime.Now - _lastActivityTime;

        if (inactiveDuration >= timeout)
        {
            // Request lock on the UI thread
            LockRequested?.Invoke(this, EventArgs.Empty);
            StopMonitoring();
        }
    }
}
