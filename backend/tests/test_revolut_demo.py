import unittest
from decimal import Decimal
from sqlalchemy import select
from app.models import Account, Transaction
from tests import test_revolut_authorization as authorization_tests
from app.services.revolut_demo import seed_demo, require_local_database


class RevolutDemoTests(unittest.IsolatedAsyncioTestCase):
    setUpClass = classmethod(authorization_tests.RevolutConnectionTests.setUpClass.__func__)
    asyncSetUp = authorization_tests.RevolutConnectionTests.asyncSetUp
    asyncTearDown = authorization_tests.RevolutConnectionTests.asyncTearDown
    provider = authorization_tests.RevolutConnectionTests.provider

    async def test_demo_is_labelled_idempotent_and_preserves_existing_accounts(self):
        self.db.add(Account(name='Cash', currency='EUR', balance=50, workspace_id=1, is_main=True))
        await self.db.commit()
        result = await seed_demo(1, self.db)
        self.assertEqual(result, {'accounts_created': 3, 'transactions_created': 9})
        self.assertEqual(await seed_demo(1, self.db), {'accounts_created': 0, 'transactions_created': 0})
        accounts = (await self.db.scalars(select(Account).order_by(Account.account_id))).all()
        self.assertEqual(accounts[0].balance, Decimal('50'))
        self.assertTrue(accounts[0].is_main)
        for account in accounts[1:]:
            self.assertTrue(account.name.startswith('[DEMO] Revolut'))
            self.assertIsNone(account.connection_id)
            self.assertEqual(account.balance, Decimal('2456.30'))
        transactions = (await self.db.scalars(select(Transaction))).all()
        self.assertEqual(len(transactions),9)
        self.assertTrue(all(t.description.startswith('[DEMO]') for t in transactions))

    async def test_business_workspace_is_rejected(self):
        with self.assertRaisesRegex(ValueError, 'Personal'):
            await seed_demo(2, self.db)
        self.assertEqual((await self.db.scalars(select(Transaction))).all(), [])

    def test_guard_rejects_production_origin_and_remote_database(self):
        for database, origin in [('sqlite+aiosqlite:///database.sqlite','https://fotosinteze.lat'),
                                 ('postgresql+asyncpg://localhost/db','http://localhost:5173')]:
            with self.assertRaisesRegex(ValueError, 'local'):
                require_local_database(database,origin)
