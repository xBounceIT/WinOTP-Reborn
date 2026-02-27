using System.Text;

namespace WinOTP.Services;

public interface IAppLogger
{
    void Info(string message);
    void Warn(string message);
    void Error(string message, Exception? ex = null);
}

public sealed class AppLogger : IAppLogger
{
    private static readonly object Sync = new();
    private const long MaxLogBytes = 1 * 1024 * 1024;

    private readonly string _logFilePath;

    public AppLogger()
    {
        var root = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "WinOTP",
            "logs");

        Directory.CreateDirectory(root);
        _logFilePath = Path.Combine(root, "winotp.log");
    }

    public void Info(string message) => Write("INFO", message);

    public void Warn(string message) => Write("WARN", message);

    public void Error(string message, Exception? ex = null)
    {
        var builder = new StringBuilder(message);
        if (ex != null)
        {
            builder.Append(" | ");
            builder.Append(ex.GetType().Name);
            builder.Append(": ");
            builder.Append(ex.Message);
        }

        Write("ERROR", builder.ToString());
    }

    private void Write(string level, string message)
    {
        lock (Sync)
        {
            RotateIfNeeded();
            var line = $"{DateTime.UtcNow:O} [{level}] {message}{Environment.NewLine}";
            File.AppendAllText(_logFilePath, line, Encoding.UTF8);
        }
    }

    private void RotateIfNeeded()
    {
        if (!File.Exists(_logFilePath))
        {
            return;
        }

        var info = new FileInfo(_logFilePath);
        if (info.Length < MaxLogBytes)
        {
            return;
        }

        var archivePath = _logFilePath + ".1";
        if (File.Exists(archivePath))
        {
            File.Delete(archivePath);
        }

        File.Move(_logFilePath, archivePath);
    }
}
