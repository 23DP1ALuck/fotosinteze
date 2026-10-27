import unittest

from app.main import app


class BankRouteTests(unittest.TestCase):
    def test_only_enable_banking_routes_are_exposed(self):
        paths = app.openapi()['paths']
        self.assertFalse(any(path.startswith('/revolut/') for path in paths))
        self.assertNotIn('/.well-known/jwks.json', paths)
        self.assertTrue({'/enable-banking/authorize', '/enable-banking/callback',
                         '/enable-banking/connection', '/enable-banking/sync'} <= paths.keys())
