// Original Prism implementation, MIT. Undocumented API names are research
// findings described in docs/devices/g70b.md; no owner baseline is embedded.
using System;
using System.IO;
using System.Linq;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text.Json;

internal static class PrismHome
{
    const string Target = "Prizen0001.Home";
    const string Operation = "http://tizen.org/appcontrol/operation/main";
    const string HomeKey = "db/appfw/home_appid";
    const string StartupKey = "db/appfw/startup_appid";
    const string AutoKey = "db/menu/smart_hub/ontvsetting/auto_start";
    static readonly string[] Keys = { HomeKey, StartupKey, "db/appfw/booting_appid_backup", "db/first_screen/type" };
    static readonly string[] WriteKeys = { HomeKey, StartupKey };
    static readonly JsonSerializerOptions Json = new JsonSerializerOptions { PropertyNameCaseInsensitive = true, PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

    [DllImport("libc")] static extern uint getuid();
    [DllImport("libc")] static extern void free(IntPtr value);
    [DllImport("libbundle.so.0")] static extern IntPtr bundle_create();
    [DllImport("libbundle.so.0")] static extern void bundle_free(IntPtr bundle);
    [DllImport("libaul.so.0")] static extern int aul_svc_set_operation(IntPtr bundle, string operation);
    [DllImport("libaul.so.0")] static extern int aul_get_default_app(IntPtr bundle, out IntPtr app);
    [DllImport("libcapi-appfw-app-operation-tv.so.0")] static extern int app_operation_set_current_app(string operation, string app);
    [DllImport("libapp-context-manager-common.so")] static extern byte util_is_appbooting_supported_webapp_byappid(string app);
    [DllImport("libvconf.so.0")] static extern IntPtr vconf_get_str(string key);
    [DllImport("libvconf.so.0")] static extern int vconf_get_int(string key, out int value);
    [DllImport("libvconf.so.0")] static extern int vconf_set_str(string key, string value);
    [DllImport("libvconf.so.0")] static extern int vconf_set_int(string key, int value);

    public sealed class Snapshot
    {
        public string Home { get; set; }
        public Dictionary<string, string> Strings { get; set; }
        public int Autostart { get; set; }
    }
    public sealed class Request
    {
        public string Mode { get; set; }
        public string Firmware { get; set; }
        public string Runtime { get; set; }
        public Snapshot Original { get; set; }
        public Snapshot Expected { get; set; }
    }
    static void Require(bool condition, string code)
    { if (!condition) throw new InvalidOperationException(code); }
    static void Validate(Snapshot value)
    {
        Require(value != null && !String.IsNullOrWhiteSpace(value.Home) && value.Home.Length <= 160 && value.Strings != null, "invalid-baseline");
        Require(value.Strings.Count == Keys.Length && Keys.All(k => value.Strings.ContainsKey(k) && value.Strings[k] != null && value.Strings[k].Length <= 160), "invalid-baseline-keys");
        Require(value.Autostart == 0 || value.Autostart == 1, "invalid-autostart");
    }
    static void Guard(Request request)
    {
        Require(request != null && new[] { "query", "roundtrip", "home", "startup", "restore" }.Contains(request.Mode), "invalid-operation");
        Require(IntPtr.Size == 4 && RuntimeInformation.ProcessArchitecture == Architecture.Arm && getuid() == 901, "wrong-architecture-or-uid");
        Require(request.Firmware == "T-PTMLWWC-1664.4" || request.Firmware == "T-PTMLWWC-1720.7", "unreviewed-firmware");
        Require(File.ReadAllText("/etc/prd_info.ini").Contains("Version=" + request.Firmware + ";"), "firmware-mismatch");
        Require(request.Runtime == "3.1.3" && Environment.Version.ToString() == request.Runtime, "runtime-mismatch");
    }
    static string ReadString(string key)
    {
        IntPtr ptr = vconf_get_str(key);
        Require(ptr != IntPtr.Zero, "read-string-failed");
        try { return Marshal.PtrToStringAnsi(ptr); } finally { free(ptr); }
    }
    static string ReadHome()
    {
        IntPtr bundle = bundle_create();
        Require(bundle != IntPtr.Zero, "bundle-failed");
        try {
            Require(aul_svc_set_operation(bundle, Operation) == 0, "query-operation-failed");
            IntPtr ptr;
            Require(aul_get_default_app(bundle, out ptr) == 0 && ptr != IntPtr.Zero, "read-home-failed");
            try { return Marshal.PtrToStringAnsi(ptr); } finally { free(ptr); }
        } finally { bundle_free(bundle); }
    }
    static Snapshot Read()
    {
        int auto;
        Require(vconf_get_int(AutoKey, out auto) == 0 && (auto == 0 || auto == 1), "read-autostart-failed");
        return new Snapshot { Home = ReadHome(), Strings = Keys.ToDictionary(k => k, ReadString), Autostart = auto };
    }
    // Observed boot/first-screen metadata can change when Samsung opens an app.
    // It is never an assignment target, including during restoration.
    static bool Equal(Snapshot a, Snapshot b) => a.Home == b.Home && a.Autostart == b.Autostart && WriteKeys.All(k => a.Strings[k] == b.Strings[k]);
    static void SetHome(string value)
    { Require(app_operation_set_current_app(Operation, value) == 0 && ReadHome() == value, "home-write-readback-failed"); }
    static void SetString(string key, string value)
    { Require(vconf_set_str(key, value) == 0 && ReadString(key) == value, "string-write-readback-failed"); }
    static void SetAuto(int value)
    { int actual; Require(vconf_set_int(AutoKey, value) == 0 && vconf_get_int(AutoKey, out actual) == 0 && actual == value, "autostart-write-readback-failed"); }
    internal interface ISettings
    {
        Snapshot Read();
        bool Eligible { get; }
        void SetHome(string value);
        void SetString(string key, string value);
        void SetAuto(int value);
    }
    sealed class NativeSettings : ISettings
    {
        public Snapshot Read() => PrismHome.Read();
        public bool Eligible => util_is_appbooting_supported_webapp_byappid(Target) == 1;
        public void SetHome(string value) => PrismHome.SetHome(value);
        public void SetString(string key, string value) => PrismHome.SetString(key, value);
        public void SetAuto(int value) => PrismHome.SetAuto(value);
    }
    static void Restore(ISettings settings, Snapshot value)
    {
        Snapshot live = settings.Read();
        if (live.Home != value.Home) settings.SetHome(value.Home);
        foreach (var key in WriteKeys) if (live.Strings[key] != value.Strings[key]) settings.SetString(key, value.Strings[key]);
        if (live.Autostart != value.Autostart) settings.SetAuto(value.Autostart);
        Require(Equal(settings.Read(), value), "restore-readback-failed");
    }
    internal static Snapshot Execute(Request r, ISettings settings)
    {
        Snapshot before = settings.Read();
        if (r.Mode == "query") return before;
        Validate(r.Original); Validate(r.Expected);
        if (r.Mode == "restore") {
            Require((before.Home == r.Original.Home || before.Home == r.Expected.Home) &&
                (before.Autostart == r.Original.Autostart || before.Autostart == r.Expected.Autostart) &&
                WriteKeys.All(k => before.Strings[k] == r.Original.Strings[k] || before.Strings[k] == r.Expected.Strings[k]), "unexpected-live-state-refuse-restore");
            Restore(settings, r.Original);
        } else {
            Require(before.Home == r.Expected.Home, "baseline-mismatch-home-operation");
            Require(before.Autostart == r.Expected.Autostart, "baseline-mismatch-autostart");
            Require(before.Strings[HomeKey] == r.Expected.Strings[HomeKey], "baseline-mismatch-home-app");
            Require(before.Strings[StartupKey] == r.Expected.Strings[StartupKey], "baseline-mismatch-startup-app");
            Require(settings.Eligible, "launcher-not-boot-eligible");
            Snapshot desired = JsonSerializer.Deserialize<Snapshot>(JsonSerializer.Serialize(before, Json), Json);
            try {
                if (r.Mode == "roundtrip") { settings.SetHome(before.Home); settings.SetString(HomeKey, before.Strings[HomeKey]); settings.SetString(StartupKey, before.Strings[StartupKey]); settings.SetAuto(before.Autostart); }
                else if (r.Mode == "home") { settings.SetHome(Target); settings.SetString(HomeKey, Target); desired.Home = Target; desired.Strings[HomeKey] = Target; }
                else if (r.Mode == "startup") { Require(before.Home == Target && before.Strings[HomeKey] == Target, "prism-not-home"); settings.SetString(StartupKey, Target); settings.SetAuto(1); desired.Strings[StartupKey] = Target; desired.Autostart = 1; }
                else throw new InvalidOperationException("invalid-operation");
                Require(Equal(settings.Read(), desired), "operation-readback-mismatch");
            } catch {
                try { Restore(settings, before); } catch { throw new InvalidOperationException("rollback-failed-recovery-required"); }
                throw new InvalidOperationException("operation-failed-rollback-readback-ok");
            }
        }
        return settings.Read();
    }
    static void Run(Request r)
    {
        Guard(r);
        var settings = new NativeSettings();
        Execute(r, settings);
        bool eligible = settings.Eligible;
        Console.WriteLine("PRISM_RESULT=" + JsonSerializer.Serialize(new { ok = true, firmware = r.Firmware, runtime = Environment.Version.ToString(), uid = getuid(), architecture = "armv7l", bootEligible = eligible, snapshot = Read() }, Json));
    }
    public static int Main(string[] args)
    {
        try {
            Require(args.Length == 1 && new FileInfo(args[0]).Length <= 16384, "invalid-request");
            Run(JsonSerializer.Deserialize<Request>(File.ReadAllText(args[0]), Json));
            return 0;
        } catch (Exception error) {
            // Never emit request contents, baselines, exception paths or raw platform output.
            string code = error is InvalidOperationException ? error.Message : error.GetType().Name;
            Console.WriteLine("PRISM_RESULT=" + JsonSerializer.Serialize(new { ok = false, code }));
            return 1;
        }
    }
}
