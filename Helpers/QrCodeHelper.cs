using System.Runtime.InteropServices.WindowsRuntime;
using Windows.Graphics.Imaging;
using Windows.Storage;
using ZXing;

namespace WinOTP.Helpers;

public static class QrCodeHelper
{
    public static async Task<string?> DecodeFromFileAsync(string filePath)
    {
        var file = await StorageFile.GetFileFromPathAsync(filePath);
        using var stream = await file.OpenReadAsync();

        var decoder = await BitmapDecoder.CreateAsync(stream);
        var bitmap = await decoder.GetSoftwareBitmapAsync(
            BitmapPixelFormat.Bgra8, BitmapAlphaMode.Premultiplied);

        return DecodeFromSoftwareBitmap(bitmap);
    }

    public static string? DecodeFromSoftwareBitmap(SoftwareBitmap bitmap)
    {
        var converted = bitmap.BitmapPixelFormat == BitmapPixelFormat.Bgra8
            ? bitmap
            : SoftwareBitmap.Convert(bitmap, BitmapPixelFormat.Bgra8, BitmapAlphaMode.Premultiplied);

        var buffer = new Windows.Storage.Streams.Buffer((uint)(converted.PixelWidth * converted.PixelHeight * 4));
        converted.CopyToBuffer(buffer);
        var pixels = buffer.ToArray();

        return DecodeFromPixels(pixels, converted.PixelWidth, converted.PixelHeight);
    }

    public static string? DecodeFromPixels(byte[] pixels, int width, int height)
    {
        try
        {
            var luminanceSource = new RGBLuminanceSource(pixels, width, height, RGBLuminanceSource.BitmapFormat.BGRA32);
            var reader = new BarcodeReaderGeneric();
            reader.Options.TryHarder = true;
            reader.Options.PossibleFormats = [BarcodeFormat.QR_CODE];

            var result = reader.Decode(luminanceSource);
            return result?.Text;
        }
        catch
        {
            return null;
        }
    }
}
