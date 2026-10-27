using System;
using System.Collections.Generic;
using System.Text.Json;

internal static class PrismHomeTests
{
    const string HomeKey = "db/appfw/home_appid", StartupKey = "db/appfw/startup_appid";
    const string Target = "Prizen0001.Home";
    static int checks;
    static PrismHome.Snapshot Copy(PrismHome.Snapshot value) => JsonSerializer.Deserialize<PrismHome.Snapshot>(JsonSerializer.Serialize(value));
    static bool Same(PrismHome.Snapshot a, PrismHome.Snapshot b) => JsonSerializer.Serialize(a) == JsonSerializer.Serialize(b);
    static void Check(bool ok, string name) { if (!ok) throw new Exception(name); checks++; }
    static PrismHome.Snapshot Original() => new PrismHome.Snapshot { Home = "example.PreviousLauncher", Autostart = 0, Strings = new Dictionary<string,string> {
        [HomeKey] = "example.PreviousLauncher", [StartupKey] = "com.samsung.tv.csfs",
        ["db/appfw/booting_appid_backup"] = "org.tizen.tv-viewer", ["db/first_screen/type"] = "com.samsung.tv.csfs" } };
    sealed class Fake : PrismHome.ISettings
    {
        internal PrismHome.Snapshot State;
        internal int Writes, FailAt, IgnoreAt;
        internal bool PersistentFailure;
        public bool Eligible { get; set; } = true;
        internal Fake(PrismHome.Snapshot value) { State = Copy(value); }
        public PrismHome.Snapshot Read() => Copy(State);
        void Write(Action action) { Writes++; if (Writes != IgnoreAt) action(); if (Writes == FailAt || (PersistentFailure && Writes >= FailAt)) throw new InvalidOperationException("simulated-readback-failure"); }
        public void SetHome(string value) => Write(() => State.Home = value);
        public void SetString(string key,string value) => Write(() => State.Strings[key] = value);
        public void SetAuto(int value) => Write(() => State.Autostart = value);
    }
    static PrismHome.Snapshot Run(Fake f, string mode, PrismHome.Snapshot original, PrismHome.Snapshot expected) => PrismHome.Execute(new PrismHome.Request { Mode = mode, Original = original, Expected = expected }, f);
    static string Refused(Action action) { try { action(); throw new Exception("expected refusal"); } catch (InvalidOperationException e) { return e.Message; } }
    public static int Main()
    {
        var original = Original();
        var fake = new Fake(original);
        Run(fake,"query",null,null);
        Check(fake.Writes == 0,"query must not write");
        Run(fake,"roundtrip",original,original);
        Check(Same(fake.State,original),"same-value roundtrip preserves every setting");
        var home = Run(fake,"home",original,original);
        Check(home.Home == Target && home.Strings[HomeKey] == Target,"assign physical Home destination");
        Check(home.Strings[StartupKey] == original.Strings[StartupKey] && home.Autostart == 0,"Home alone must not change startup");
        var desired = Run(fake,"startup",original,home);
        Check(desired.Strings[StartupKey] == Target && desired.Autostart == 1,"separate startup assignment");
        Check(desired.Strings["db/appfw/booting_appid_backup"] == original.Strings["db/appfw/booting_appid_backup"],"preserve native video fallback");
        Run(fake,"restore",original,desired);
        Check(Same(fake.State,original),"restore original third-party Home and all values");
        int writes = fake.Writes; Run(fake,"restore",original,desired);
        Check(fake.Writes == writes,"repeat restore must not write");
        foreach (string mode in new[] {"home","startup"}) {
            var baseline = mode == "startup" ? home : original;
            for (int at=1;at<=2;at++) {
                fake = new Fake(baseline) { FailAt=at };
                Check(Refused(()=>Run(fake,mode,original,baseline)) == "operation-failed-rollback-readback-ok","partial write must report rollback");
                Check(Same(fake.State,baseline),"partial operation must restore pre-operation state");
                fake = new Fake(baseline) { IgnoreAt=at };
                Refused(()=>Run(fake,mode,original,baseline));
                Check(Same(fake.State,baseline),"silent no-op must be detected and restored");
            }
        }
        fake = new Fake(original) { Eligible=false };
        Refused(()=>Run(fake,"home",original,original)); Check(fake.Writes == 0,"boot-ineligible target must not write");
        fake = new Fake(home);
        Refused(()=>Run(fake,"home",original,original)); Check(fake.Writes == 0,"stale baseline must not write");
        fake = new Fake(original);
        Refused(()=>Run(fake,"startup",original,original)); Check(fake.Writes == 0,"startup requires Prism already assigned Home");
        var unrelated = Copy(desired); unrelated.Home = "example.Unrelated"; fake = new Fake(unrelated);
        Refused(()=>Run(fake,"restore",original,desired)); Check(fake.Writes == 0,"unrelated live state must refuse restore");
        // Power loss could leave any subset of the planned writes. Restore each combination.
        for (int mask=0;mask<16;mask++) {
            var partial=Copy(original);
            if ((mask&1)!=0) partial.Home=Target;
            if ((mask&2)!=0) partial.Strings[HomeKey]=Target;
            if ((mask&4)!=0) partial.Strings[StartupKey]=Target;
            if ((mask&8)!=0) partial.Autostart=1;
            fake=new Fake(partial); Run(fake,"restore",original,desired);
            Check(Same(fake.State,original),"interrupted combination must restore");
        }
        fake = new Fake(original) { FailAt=2, PersistentFailure=true };
        Check(Refused(()=>Run(fake,"home",original,original)) == "rollback-failed-recovery-required","rollback failure must be explicit");
        var malformed=Copy(original); malformed.Strings["unapproved/key"]="value"; fake=new Fake(original);
        Refused(()=>Run(fake,"home",malformed,original)); Check(fake.Writes == 0,"unknown baseline keys must not write");
        // Samsung updates this observational value after a real Home/app launch.
        var observed=Copy(original); observed.Strings["db/appfw/booting_appid_backup"]="example.PlatformManaged";
        fake=new Fake(observed);
        Run(fake,"home",original,original);
        Check(fake.State.Home == Target,"platform-managed observation drift must not block owned assignment");
        Check(fake.State.Strings["db/appfw/booting_appid_backup"] == "example.PlatformManaged","apply must preserve observed-only metadata");
        Run(fake,"restore",original,desired);
        Check(fake.State.Home == original.Home,"restore must still recover the original Home");
        Check(fake.State.Strings["db/appfw/booting_appid_backup"] == "example.PlatformManaged","restore must not overwrite observed-only metadata");
        Console.WriteLine($"Native transaction checks passed: {checks}. No TV libraries were invoked.");
        return 0;
    }
}
