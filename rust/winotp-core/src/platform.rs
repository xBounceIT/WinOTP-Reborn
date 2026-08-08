//! Operating-system capabilities that cannot belong in the portable core.
//!
//! The public functions keep the JSON sidecar contract stable on every
//! platform. Windows-only integrations are compiled behind `cfg(windows)`;
//! other platforms return a deliberate unavailable result instead of invoking
//! a shell or embedding another native language runtime.

use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LegacyCredentialEntry {
    pub resource: String,
    pub id: String,
    pub payload: Option<String>,
    pub issue: Option<String>,
}

#[cfg(windows)]
mod windows_impl {
    use std::collections::HashSet;
    use std::ffi::c_void;
    use std::sync::mpsc;

    use windows::core::{Result as WindowsResult, HSTRING, PCWSTR};
    use windows::Security::Credentials::UI::{
        UserConsentVerificationResult, UserConsentVerifier, UserConsentVerifierAvailability,
    };
    use windows::Security::Credentials::{PasswordCredential, PasswordVault};
    use windows::Win32::Foundation::{GetLastError, HINSTANCE, HWND, LPARAM, LRESULT, WPARAM};
    use windows::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows::Win32::System::RemoteDesktop::{
        WTSRegisterSessionNotification, WTSUnRegisterSessionNotification, NOTIFY_FOR_THIS_SESSION,
    };
    use windows::Win32::System::WinRT::{
        IUserConsentVerifierInterop, RoGetActivationFactory, RoInitialize, RoUninitialize,
        RO_INIT_MULTITHREADED,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, DefWindowProcW, DispatchMessageW, GetMessageW, GetSystemMetrics,
        GetWindowLongPtrW, RegisterClassW, SetWindowLongPtrW, TranslateMessage, GWLP_USERDATA,
        HWND_MESSAGE, MSG, SM_REMOTESESSION, WINDOW_EX_STYLE, WINDOW_STYLE, WM_WTSSESSION_CHANGE,
        WNDCLASSW, WTS_CONSOLE_CONNECT, WTS_CONSOLE_DISCONNECT, WTS_REMOTE_CONNECT,
        WTS_REMOTE_DISCONNECT,
    };
    use windows_future::IAsyncOperation;

    const USER_CONSENT_VERIFIER_CLASS: &str = "Windows.Security.Credentials.UI.UserConsentVerifier";
    const ELEMENT_NOT_FOUND_HRESULT: u32 = 0x8007_0490;

    fn with_winrt<T>(operation: impl FnOnce() -> WindowsResult<T>) -> Result<T, String> {
        unsafe { RoInitialize(RO_INIT_MULTITHREADED) }
            .map_err(|error| format!("Unable to initialize Windows Runtime: {error}"))?;

        let result = operation().map_err(|error| error.to_string());
        unsafe { RoUninitialize() };
        result
    }

    fn window_handle(raw: u64) -> Result<HWND, String> {
        if raw == 0 {
            return Err("A valid application window handle is required.".to_string());
        }
        Ok(HWND(raw as usize as *mut c_void))
    }

    fn availability_name(value: UserConsentVerifierAvailability) -> &'static str {
        match value {
            UserConsentVerifierAvailability::Available => "Available",
            UserConsentVerifierAvailability::DeviceNotPresent => "DeviceNotPresent",
            UserConsentVerifierAvailability::NotConfiguredForUser => "NotConfiguredForUser",
            UserConsentVerifierAvailability::DisabledByPolicy => "DisabledByPolicy",
            UserConsentVerifierAvailability::DeviceBusy => "DeviceBusy",
            _ => "Error",
        }
    }

    fn verification_name(value: UserConsentVerificationResult) -> &'static str {
        match value {
            UserConsentVerificationResult::Verified => "Verified",
            UserConsentVerificationResult::DeviceNotPresent => "DeviceNotPresent",
            UserConsentVerificationResult::NotConfiguredForUser => "NotConfiguredForUser",
            UserConsentVerificationResult::DisabledByPolicy => "DisabledByPolicy",
            UserConsentVerificationResult::DeviceBusy => "DeviceBusy",
            UserConsentVerificationResult::RetriesExhausted => "RetriesExhausted",
            UserConsentVerificationResult::Canceled => "Canceled",
            _ => "Error",
        }
    }

    pub fn windows_hello_availability() -> Result<String, String> {
        if unsafe { GetSystemMetrics(SM_REMOTESESSION) } != 0 {
            return Ok("RemoteSession".to_string());
        }

        with_winrt(|| {
            let availability = UserConsentVerifier::CheckAvailabilityAsync()?.join()?;
            Ok(availability_name(availability).to_string())
        })
    }

    pub fn windows_hello_verify(raw_window_handle: u64) -> Result<String, String> {
        if unsafe { GetSystemMetrics(SM_REMOTESESSION) } != 0 {
            return Ok("RemoteSession".to_string());
        }

        let hwnd = window_handle(raw_window_handle)?;
        with_winrt(|| {
            let class_name = HSTRING::from(USER_CONSENT_VERIFIER_CLASS);
            let message = HSTRING::from("Verify your identity for WinOTP");
            let factory: IUserConsentVerifierInterop =
                unsafe { RoGetActivationFactory(&class_name)? };
            let operation: IAsyncOperation<UserConsentVerificationResult> =
                unsafe { factory.RequestVerificationForWindowAsync(hwnd, &message)? };
            let verification = operation.join()?;
            Ok(verification_name(verification).to_string())
        })
    }

    pub fn register_session_notification(raw_window_handle: u64) -> Result<(), String> {
        let hwnd = window_handle(raw_window_handle)?;
        unsafe { WTSRegisterSessionNotification(hwnd, NOTIFY_FOR_THIS_SESSION) }
            .map_err(|error| error.to_string())
    }

    pub fn unregister_session_notification(raw_window_handle: u64) -> Result<(), String> {
        let hwnd = window_handle(raw_window_handle)?;
        unsafe { WTSUnRegisterSessionNotification(hwnd) }.map_err(|error| error.to_string())
    }

    fn session_change_reason(code: u32) -> Option<&'static str> {
        match code {
            WTS_CONSOLE_CONNECT => Some("console-connect"),
            WTS_CONSOLE_DISCONNECT => Some("console-disconnect"),
            WTS_REMOTE_CONNECT => Some("remote-connect"),
            WTS_REMOTE_DISCONNECT => Some("remote-disconnect"),
            _ => None,
        }
    }

    struct SessionNotificationContext {
        events: mpsc::Sender<(u32, &'static str)>,
    }

    unsafe extern "system" fn session_change_window_proc(
        hwnd: HWND,
        message: u32,
        wparam: WPARAM,
        lparam: LPARAM,
    ) -> LRESULT {
        if message == WM_WTSSESSION_CHANGE {
            let context = GetWindowLongPtrW(hwnd, GWLP_USERDATA) as *mut SessionNotificationContext;
            if !context.is_null() {
                let code = wparam.0 as u32;
                if let Some(reason) = session_change_reason(code) {
                    let _ = unsafe { (*context).events.send((code, reason)) };
                }
            }
            return LRESULT(0);
        }
        unsafe { DefWindowProcW(hwnd, message, wparam, lparam) }
    }

    fn run_session_notification_watch_thread(
        events: mpsc::Sender<(u32, &'static str)>,
    ) -> Result<(), String> {
        unsafe {
            let class_name = "WinOTP.SessionChangeWatcher\0"
                .encode_utf16()
                .collect::<Vec<u16>>();
            let instance = HINSTANCE(GetModuleHandleW(None).map_err(|error| error.to_string())?.0);
            let window_class = WNDCLASSW {
                lpfnWndProc: Some(session_change_window_proc),
                hInstance: instance,
                lpszClassName: PCWSTR(class_name.as_ptr()),
                ..Default::default()
            };
            if RegisterClassW(&window_class) == 0 {
                return Err(format!(
                    "Unable to register the session watcher window class: {}",
                    GetLastError().0
                ));
            }

            // The context lives for the whole watcher process: the window
            // procedure reads it on every transition and nothing destroys it.
            let context = Box::new(SessionNotificationContext { events });
            let context_ptr = Box::into_raw(context);
            let window = CreateWindowExW(
                WINDOW_EX_STYLE(0),
                PCWSTR(class_name.as_ptr()),
                PCWSTR::null(),
                WINDOW_STYLE(0),
                0,
                0,
                0,
                0,
                Some(HWND_MESSAGE),
                None,
                Some(instance),
                Some(context_ptr as *const c_void),
            )
            .map_err(|error| format!("Unable to create the session watcher window: {error}"))?;
            SetWindowLongPtrW(window, GWLP_USERDATA, context_ptr as isize);
            WTSRegisterSessionNotification(window, NOTIFY_FOR_THIS_SESSION)
                .map_err(|error| format!("Unable to register session notifications: {error}"))?;

            let mut message = MSG::default();
            loop {
                let result = GetMessageW(&mut message, None, 0, 0);
                if result.0 == 0 || result.0 == -1 {
                    break;
                }
                let _ = TranslateMessage(&message);
                DispatchMessageW(&message);
            }
        }
        Ok(())
    }

    pub fn run_session_notification_watch() -> Result<mpsc::Receiver<(u32, &'static str)>, String> {
        let (sender, receiver) = mpsc::channel();
        std::thread::spawn(move || {
            if let Err(error) = run_session_notification_watch_thread(sender) {
                println!("{{\"ok\":false,\"error\":{error:?}}}");
            }
        });
        Ok(receiver)
    }

    pub fn read_legacy_credentials(
        resources: &[String],
    ) -> Result<Vec<super::LegacyCredentialEntry>, String> {
        let requested_resources = resources
            .iter()
            .map(|resource| resource.trim())
            .filter(|resource| !resource.is_empty())
            .collect::<HashSet<_>>();
        if requested_resources.is_empty() {
            return Ok(Vec::new());
        }

        with_winrt(|| {
            let vault = PasswordVault::new()?;
            let credentials = match vault.RetrieveAll() {
                Ok(credentials) => credentials,
                Err(error) if error.code().0 as u32 == ELEMENT_NOT_FOUND_HRESULT => {
                    return Ok(Vec::new());
                }
                Err(error) => return Err(error),
            };
            let mut entries = Vec::new();
            for index in 0..credentials.Size()? {
                let credential: PasswordCredential = credentials.GetAt(index)?;
                let resource = credential.Resource()?.to_string_lossy();
                if !requested_resources.contains(resource.as_str()) {
                    continue;
                }

                let username = credential.UserName()?.to_string_lossy();
                let id = if username.trim().is_empty() {
                    "(unknown)".to_string()
                } else {
                    username
                };
                let (payload, issue) = match credential.RetrievePassword() {
                    Ok(()) => match credential.Password() {
                        Ok(password) => (Some(password.to_string_lossy()), None),
                        Err(_) => (None, Some("retrieve-failed".to_string())),
                    },
                    Err(_) => (None, Some("retrieve-failed".to_string())),
                };
                entries.push(super::LegacyCredentialEntry {
                    resource,
                    id,
                    payload,
                    issue,
                });
            }
            Ok(entries)
        })
    }
}

#[cfg(not(windows))]
mod windows_impl {
    pub fn windows_hello_availability() -> Result<String, String> {
        Err("Windows Hello is only available on Windows.".to_string())
    }

    pub fn windows_hello_verify(_raw_window_handle: u64) -> Result<String, String> {
        Err("Windows Hello is only available on Windows.".to_string())
    }

    pub fn register_session_notification(_raw_window_handle: u64) -> Result<(), String> {
        Err("Windows session notifications are only available on Windows.".to_string())
    }

    pub fn unregister_session_notification(_raw_window_handle: u64) -> Result<(), String> {
        Err("Windows session notifications are only available on Windows.".to_string())
    }

    pub fn run_session_notification_watch(
    ) -> Result<std::sync::mpsc::Receiver<(u32, &'static str)>, String> {
        Err("Windows session notifications are only available on Windows.".to_string())
    }

    pub fn read_legacy_credentials(
        _resources: &[String],
    ) -> Result<Vec<super::LegacyCredentialEntry>, String> {
        Err("Windows Credential Manager migration is only available on Windows.".to_string())
    }
}

pub use windows_impl::{
    read_legacy_credentials, register_session_notification, run_session_notification_watch,
    unregister_session_notification, windows_hello_availability, windows_hello_verify,
};
