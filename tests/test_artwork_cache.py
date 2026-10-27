import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'tools'))
from artwork_cache import artwork_map, artwork_script

class ArtworkCacheTest(unittest.TestCase):
    def test_pairs_native_identity_with_its_store_cache(self):
        metadata = '''--------------------------------
--------------app_panel_icon_path =/opt/share/webappservice/apps_icon/all/123/-------------
--------------app_tizen_id =example.Video-------------
--------------------------------
--------------app_panel_icon_path =/opt/share/webappservice/apps_icon/all/456/-------------
--------------app_tizen_id =example.Other-------------'''
        result = artwork_map(metadata)
        self.assertEqual(result['example.Video'][0], 'file:///opt/share/webappservice/apps_icon/all/123/304x304.png')
        self.assertIn('/456/', result['example.Other'][0])
        self.assertNotIn('app_panel_icon_path', artwork_script(metadata))

    def test_rejects_arbitrary_paths_and_unpaired_records(self):
        metadata = '''--------------app_panel_icon_path =/etc/-------------
--------------app_tizen_id =example.Bad-------------
--------------------------------
--------------app_tizen_id =example.NoPath-------------
--------------app_panel_icon_path =/opt/share/webappservice/apps_icon/all/../-------------
--------------app_tizen_id =example.Traversal-------------'''
        self.assertEqual(artwork_map(metadata), {})

if __name__ == '__main__': unittest.main()
