"""Offline setup regression checks. No real monitor or owner credentials."""
import copy
import base64
from datetime import datetime, timedelta, timezone
import hashlib
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch, Mock
import zipfile
import xml.etree.ElementTree as ET

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "tools"))
import setup
import device_registry


def app_list(version="0.2.6"):
    return f"""--------------------------------
--------------app_id =store-identifier-------------
--------------app_tizen_id =Prizen0001.Home-------------
--------------app_version ={version}-------------
--------------------------------
--------------app_tizen_id =example.Other-------------
--------------app_version =1.0.0-------------
"""


def wallpaper_files(resolution="1080p"):
    width, height = (3840, 2160) if resolution == "2160p" else (1920, 1080)
    image = b"test JPEG payload"
    manifest = {"schema": 1, "resolution": resolution, "width": width, "height": height,
                "images": [{"id": "example", "file": "wallpapers/example.jpg", "width": width,
                            "height": height, "sha256": hashlib.sha256(image).hexdigest()}]}
    return {"wallpapers/manifest.json": json.dumps(manifest).encode(), "wallpapers/example.jpg": image,
            "wallpapers/example-thumb.jpg": b"thumbnail", "wallpapers/example-frost.jpg": b"frost"}


def snapshot():
    return {"home": "example.Previous", "strings": {
        "db/appfw/home_appid": "example.Previous",
        "db/appfw/startup_appid": "com.samsung.tv.csfs",
        "db/appfw/booting_appid_backup": "org.tizen.tv-viewer",
        "db/first_screen/type": "com.samsung.tv.csfs"}, "autostart": 0}


class SetupTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="prism-test-")
        self.addCleanup(self.temp.cleanup)
        self.state = Path(self.temp.name)

    def test_network_targets_are_explicit_private_unicast(self):
        for address in ("127.0.0.1", "0.0.0.0", "169.254.1.2", "224.0.0.1", "8.8.8.8", "255.255.255.255", "tv.local", "::1", "192.0.2.4"):
            with self.subTest(address=address), self.assertRaises(setup.SetupError):
                setup.select_tv(address)
        self.assertEqual(setup.select_tv("192.168.5.8"), "192.168.5.8")
        with patch("sys.stdin.isatty", return_value=False), self.assertRaises(setup.SetupError):
            setup.select_tv(None)

    def test_private_paths_reject_checkout_and_symlink_escape(self):
        for path in (setup.ROOT, setup.ROOT / ".private" / "certs"):
            with self.assertRaises(setup.SetupError):
                setup.external_path(path)
        linked = self.state / "repo"
        linked.symlink_to(setup.ROOT, target_is_directory=True)
        with self.assertRaises(setup.SetupError):
            setup.private_json(linked / "accidental-secret.json", {"secret": "not-written"})
        with self.assertRaises(setup.SetupError):
            with setup.state_lock(linked):
                self.fail("lock must not write through a checkout symlink")

    def test_private_record_replacement_is_atomic_and_restricted(self):
        path = self.state / "baseline.json"
        setup.private_json(path, {"original": 1})
        setup.private_json(path, {"original": 2})
        self.assertEqual(json.loads(path.read_text()), {"original": 2})
        if os.name != "nt":
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
        self.assertEqual(len(list(self.state.glob(".prism-*"))), 0)

    def test_parallel_setup_refuses_second_writer(self):
        with setup.state_lock(self.state):
            with self.assertRaises(setup.SetupError):
                with setup.state_lock(self.state):
                    self.fail("second setup must not acquire the lock")
        self.assertFalse((self.state / "setup.lock").exists())

    def test_exact_profiles_not_just_tizen_or_numeric_firmware(self):
        self.assertIsNotNone(setup.match_profile("LS28BG702EWXXL", "T-PTMLWWC-1720.7"))
        self.assertIsNone(setup.match_profile("LS28BG702EWXXL", "T-PTMDEUC-1720.7"))
        self.assertIsNone(setup.match_profile("DifferentMonitor", "T-PTMLWWC-1720.7"))

    def test_install_failure_does_not_accept_old_listing(self):
        setup.verify_install("app_id[Prizen0001.Home] install completed", app_list(), "0.2.6")
        for output, listing in (("install failed", app_list()), ("install completed", app_list("0.2.5")), ("install completed", "")):
            with self.subTest(output=output, listing=bool(listing)), self.assertRaises(setup.SetupError):
                setup.verify_install(output, listing, "0.2.6")

    def test_widget_preserves_identity_replaces_device_data_and_strips_signatures(self):
        unsigned, prepared = self.state / "unsigned.wgt", self.state / "prepared.wgt"
        manifest = (setup.ROOT / "tizen/config.xml").read_bytes()
        with zipfile.ZipFile(unsigned, "w") as archive:
            for name, content in {"config.xml": manifest, "index.html": b"app", "device-artwork.js": b"old", "device-profile.js": b"old", "author-signature.xml": b"old-signature", "signature1.xml": b"old-signature", **wallpaper_files()}.items():
                archive.writestr(name, content)
        profile = {"logical_surface": {"width": 1280, "height": 720}}
        setup.prepare_widget(unsigned, prepared, "", profile)
        with zipfile.ZipFile(prepared) as archive:
            self.assertEqual(archive.read("config.xml"), manifest)
            self.assertIn(b'"width": 1280', archive.read("device-profile.js"))
            self.assertNotIn("author-signature.xml", archive.namelist())
            self.assertNotIn("signature1.xml", archive.namelist())

    def test_wallpaper_selection_requires_verified_4k_surface(self):
        for surface, expected in [({}, "1080p"),
                                  ({"width": 1280, "height": 720, "verified": True}, "1080p"),
                                  ({"width": 1920, "height": 1080, "verified": True}, "1080p"),
                                  ({"width": 3840, "height": 2160}, "1080p"),
                                  ({"width": 3840, "height": 2160, "verified": True}, "2160p")]:
            profile = {"logical_surface": surface}
            self.assertEqual(setup.wallpaper_resolution(profile), expected)
            self.assertEqual(setup.widget_path("0.2.9", profile).name, f"Prism-0.2.9-{expected}-unsigned.wgt")
        self.assertEqual(setup.wallpaper_resolution(None), "1080p")

    def test_wallpaper_package_refuses_missing_mismatched_and_corrupt_assets(self):
        for resolution in ("1080p", "2160p"):
            profile = {"logical_surface": {"width": 3840, "height": 2160, "verified": True}} if resolution == "2160p" else None
            for problem in (None, "missing-manifest", "missing-image", "missing-frost", "missing-thumbnail", "corrupt-image", "wrong-resolution"):
                with self.subTest(resolution=resolution, problem=problem):
                    files = wallpaper_files(resolution)
                    if problem == "missing-manifest": del files["wallpapers/manifest.json"]
                    if problem == "missing-image": del files["wallpapers/example.jpg"]
                    if problem == "missing-frost": del files["wallpapers/example-frost.jpg"]
                    if problem == "missing-thumbnail": del files["wallpapers/example-thumb.jpg"]
                    if problem == "corrupt-image": files["wallpapers/example.jpg"] = b"changed"
                    if problem == "wrong-resolution": files = wallpaper_files("1080p" if resolution == "2160p" else "2160p")
                    path = self.state / "variant.wgt"
                    with zipfile.ZipFile(path, "w") as archive:
                        for name, content in files.items(): archive.writestr(name, content)
                    with zipfile.ZipFile(path) as archive:
                        if problem:
                            with self.assertRaises(setup.SetupError): setup.validate_wallpapers(archive, profile)
                        else:
                            setup.validate_wallpapers(archive, profile)

    def test_report_allowlist_never_infers_physical_success(self):
        report = setup.report({"model": "ExampleModel", "installation": "verified", "native_state": "applied-readback", "password": "DO_NOT_LEAK", "device_hash": "DO_NOT_LEAK", "cert_dir": "DO_NOT_LEAK", "original": "DO_NOT_LEAK", "tv": "DO_NOT_LEAK"})
        self.assertNotIn("DO_NOT_LEAK", report)
        self.assertIn("home: not yet confirmed", report)
        self.assertIn("cold_boot: not yet confirmed", report)

    def test_changed_author_refuses_before_install(self):
        connection = Mock()
        with patch("setup.certificate_files", return_value=self.state), patch("setup.certificate_identity", return_value="new"), self.assertRaises(setup.SetupError):
            setup.install(connection, self.state, {"author_fingerprint": "old"}, self.state, None)
        connection.install.assert_not_called()
        connection.uninstall.assert_not_called()

    def test_doctor_rejects_wrong_host_before_developer_connection(self):
        with patch("setup.device_info", return_value={"developerMode": "1", "developerIP": "192.168.5.99"}), patch("setup.route_ip", return_value="192.168.5.2"), patch("setup.Sdb") as transport, self.assertRaises(setup.SetupError):
            setup.main(["doctor", "--tv", "192.168.5.8", "--state-dir", str(self.state)])
        transport.assert_not_called()

    def test_query_flag_cannot_accidentally_install(self):
        with patch("setup.device_info") as network, patch("sys.stderr"), self.assertRaises(SystemExit) as error:
            setup.main(["install", "--query", "--tv", "192.168.5.8"])
        self.assertEqual(error.exception.code, 2)
        network.assert_not_called()

    def test_device_address_reuse_refuses_old_baseline(self):
        state = self.state / hashlib.sha256(b"192.168.5.8").hexdigest()[:20]
        setup.private_json(state / "setup.json", {"device_hash": "different-device"})
        connection = Mock()
        connection.__enter__ = Mock(return_value=connection)
        connection.__exit__ = Mock(return_value=False)
        connection.duid.return_value = "private-test-device"
        with patch("setup.device_info", return_value={"developerMode": "1", "developerIP": "192.168.5.2"}), patch("setup.route_ip", return_value="192.168.5.2"), patch("setup.Sdb", return_value=Mock(connect=Mock(return_value=connection))), self.assertRaises(setup.SetupError):
            setup.main(["home", "--tv", "192.168.5.8", "--state-dir", str(self.state)])
        connection.install.assert_not_called()

    def test_registry_links_and_generated_table_match(self):
        generated = device_registry.render(device_registry.profiles())
        self.assertEqual((setup.ROOT / "VERIFIED_DEVICES.md").read_text(), generated)


class NativeCoordinatorTests(unittest.TestCase):
    setUp = SetupTests.setUp
    def test_startup_failure_restores_full_original_and_retains_recovery(self):
        args = setup.parser().parse_args(["home", "--tv", "192.168.5.8", "--trial"])
        profile = setup.match_profile("LS28BG702EWXXL", "T-PTMLWWC-1720.7")
        original = snapshot()
        live = copy.deepcopy(original)
        operations = []
        record = {"installation": "verified", "foreground_readback": "verified", "prism_build": "0.2.6"}

        def native(_connection, _tv, _profile, mode, request, *_args):
            nonlocal live
            operations.append(mode)
            if mode == "home":
                live["home"] = setup.APP_ID
                live["strings"]["db/appfw/home_appid"] = setup.APP_ID
            if mode == "startup":
                live["strings"]["db/appfw/startup_appid"] = setup.APP_ID
                raise setup.SetupError("simulated lost reply after startup write")
            if mode == "restore":
                live = copy.deepcopy(request["original"])
            return {"snapshot": copy.deepcopy(live), "firmware": profile["firmware"], "runtime": "3.1.3", "architecture": "armv7l", "uid": 901}

        connection = Mock(applist=Mock(return_value=app_list()))
        with patch("native_runner.run_native", side_effect=native), self.assertRaises(setup.SetupError):
            setup.native_stage(args, connection, record, self.state, profile, "apply")
        self.assertEqual(live, original)
        self.assertEqual(record["native_state"], "restored-after-failure")
        self.assertEqual(json.loads((self.state / "original.json").read_text()), original)
        self.assertEqual(operations, ["query", "roundtrip", "restore", "home", "startup", "restore"])

    def test_candidate_and_unknown_profiles_refuse_before_any_native_call(self):
        args = setup.parser().parse_args(["home", "--tv", "192.168.5.8"])
        with patch("native_runner.run_native") as native:
            candidate = copy.deepcopy(setup.match_profile("LS28BG702EWXXL", "T-PTMLWWC-1720.7"))
            candidate["native"]["status"] = "candidate"
            for profile in (None, candidate):
                with self.assertRaises(setup.SetupError):
                    setup.native_stage(args, Mock(), {}, self.state, profile, "apply")
            native.assert_not_called()

    def test_repeated_apply_is_read_only_when_saved_desired_state_matches(self):
        args = setup.parser().parse_args(["home", "--tv", "192.168.5.8", "--trial"])
        profile = setup.match_profile("LS28BG702EWXXL", "T-PTMLWWC-1720.7")
        original = snapshot()
        desired = copy.deepcopy(original)
        desired["home"] = setup.APP_ID
        desired["strings"]["db/appfw/home_appid"] = setup.APP_ID
        desired["strings"]["db/appfw/startup_appid"] = setup.APP_ID
        desired["autostart"] = 1
        setup.private_json(self.state / "original.json", original)
        record = {"installation": "verified", "foreground_readback": "verified", "prism_build": "0.2.6", "native_state": "applied-readback"}
        result = {"snapshot": desired, "firmware": profile["firmware"], "runtime": "3.1.3", "architecture": "armv7l", "uid": 901}
        with patch("native_runner.run_native", return_value=result) as native:
            setup.native_stage(args, Mock(applist=Mock(return_value=app_list())), record, self.state, profile, "apply")
        self.assertEqual(native.call_count, 1)
        self.assertEqual(native.call_args.args[3], "query")

    def test_interrupted_apply_does_not_stack_new_writes(self):
        args = setup.parser().parse_args(["home", "--tv", "192.168.5.8", "--trial"])
        profile = setup.match_profile("LS28BG702EWXXL", "T-PTMLWWC-1720.7")
        original = snapshot()
        partial = copy.deepcopy(original)
        partial["home"] = setup.APP_ID
        setup.private_json(self.state / "original.json", original)
        record = {"installation": "verified", "foreground_readback": "verified", "prism_build": "0.2.6", "native_state": "pending"}
        result = {"snapshot": partial, "firmware": profile["firmware"], "runtime": "3.1.3", "architecture": "armv7l", "uid": 901}
        with patch("native_runner.run_native", return_value=result) as native, self.assertRaises(setup.SetupError):
            setup.native_stage(args, Mock(applist=Mock(return_value=app_list())), record, self.state, profile, "apply")
        self.assertEqual(native.call_count, 1)
        self.assertEqual(native.call_args.args[3], "query")

    def test_only_owned_settings_participate_in_state_comparison(self):
        before = snapshot()
        observed_drift = copy.deepcopy(before)
        observed_drift["strings"]["db/appfw/booting_appid_backup"] = "example.PlatformManaged"
        self.assertEqual(setup.owned_snapshot(before), setup.owned_snapshot(observed_drift))
        observed_drift["strings"]["db/appfw/startup_appid"] = "example.UnrelatedStartup"
        self.assertNotEqual(setup.owned_snapshot(before), setup.owned_snapshot(observed_drift))


class SigningTests(unittest.TestCase):
    setUp = SetupTests.setUp

    def test_generated_test_credentials_sign_all_files_and_preserve_author_identity(self):
        try:
            from cryptography import x509
            from cryptography.x509.oid import NameOID
            from cryptography.hazmat.primitives import hashes, serialization
            from cryptography.hazmat.primitives.asymmetric import rsa, padding
            from cryptography.hazmat.primitives.serialization import pkcs12
        except ImportError:
            self.skipTest("Install requirements-setup.txt to run signing checks")
        from vendor.tizen.signer import sign_wgt
        key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "Prism ephemeral test")])
        now = datetime.now(timezone.utc)
        certificate = (x509.CertificateBuilder().subject_name(name).issuer_name(name)
                       .public_key(key.public_key()).serial_number(x509.random_serial_number())
                       .not_valid_before(now - timedelta(minutes=1)).not_valid_after(now + timedelta(days=1))
                       .sign(key, hashes.SHA256()))
        credentials = self.state / "credentials"
        credentials.mkdir()
        for kind in ("author", "distributor"):
            (credentials / f"{kind}.p12").write_bytes(pkcs12.serialize_key_and_certificates(kind.encode(), key, certificate, [], serialization.BestAvailableEncryption(b"ephemeral-test-password")))
        (credentials / "password.txt").write_text("ephemeral-test-password")
        (credentials / "device-profile.xml").write_text("<test-profile />")
        identity = setup.certificate_identity(credentials)
        unsigned, signed = self.state / "unsigned.wgt", self.state / "signed.wgt"
        files = {"config.xml": b"<widget />", "index.html": b"<h1>test</h1>", "assets/a file.js": b"test"}
        with zipfile.ZipFile(unsigned, "w") as archive:
            for filename, content in files.items():
                archive.writestr(filename, content)
        sign_wgt(unsigned, signed, credentials)
        ns = {"d": "http://www.w3.org/2000/09/xmldsig#"}
        with zipfile.ZipFile(signed) as archive:
            for filename in ("author-signature.xml", "signature1.xml"):
                xml = archive.read(filename)
                tree = ET.fromstring(xml)
                # Verify RSA against the actual emitted canonical SignedInfo, not the implementation helper.
                start = xml.index(b"<SignedInfo>")
                end = xml.index(b"</SignedInfo>") + len(b"</SignedInfo>")
                canonical = xml[start:end].replace(b"<SignedInfo>", b'<SignedInfo xmlns="http://www.w3.org/2000/09/xmldsig#">', 1)
                signature = base64.b64decode(tree.find("d:SignatureValue", ns).text)
                certificate.public_key().verify(signature, canonical, padding.PKCS1v15(), hashes.SHA512())
                from urllib.parse import unquote
                for reference in tree.findall("d:SignedInfo/d:Reference", ns):
                    uri = reference.attrib["URI"]
                    if not uri.startswith("#"):
                        content = archive.read(unquote(uri))
                        self.assertEqual(base64.b64decode(reference.find("d:DigestValue", ns).text), hashlib.sha512(content).digest())
            self.assertEqual(archive.read("index.html"), files["index.html"])
        self.assertEqual(setup.certificate_identity(credentials), identity)
        (credentials / "password.txt").write_text("wrong")
        with self.assertRaises(setup.SetupError) as error:
            setup.certificate_identity(credentials)
        self.assertNotIn("ephemeral-test-password", str(error.exception))


if __name__ == "__main__":
    unittest.main()
